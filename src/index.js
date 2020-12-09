const fs = require('fs').promises
const path = require('path')
const toml = require('@iarna/toml')

/**
 @typedef {{
  from: string,
  to: string,
  conditions?: {
    Role?: string[],
  },
  status?: number,
  force?: boolean,
}} NetlifyRedirect
*/

/**
@typedef {{
   build: {
     publish: string,
     functions?: string,
   },
   redirects: NetlifyRedirect[],
 }} NetlifyConfig
*/

const loginPage = '/_netlify-sso'
const authFunc = 'sso-auth'

/**
 * @param {{ config: NetlifyConfig, functionsDir?: string, publishDir?: string }} params
 */
async function generateSSO({
  config /* &mut */,
  functionsDir = '_netlify_sso_functions',
  publishDir = '_netlify_sso_publish',
}) {
  config.build = {
    ...config.build,
    functions: functionsDir,
    publish: publishDir,
  }

  await fs.mkdir(functionsDir, { recursive: true })
  await fs.mkdir(publishDir, { recursive: true })

  const staticFileDir = path.resolve(__dirname, '../static')
  await fs.copyFile(
    path.join(staticFileDir, 'sso-login.html'),
    path.join(publishDir, `${loginPage}.html`),
  )
  await fs.copyFile(
    path.join(staticFileDir, 'sso-auth-function.js'),
    path.join(functionsDir, `${authFunc}.js`),
  )

  /** @type {NetlifyRedirect[]} */
  const gatedRedirects = config.redirects.map((redirect) => ({
    ...redirect,
    conditions: {
      Role: ['netlify'],
    },
  }))

  /** @type {NetlifyRedirect[]} */
  const additionalRedirects = [
    // Serve content when logged in
    {
      from: '/*',
      to: '/:splat',
      conditions: {
        Role: ['netlify'],
      },
      // will be set to 200 when there is content
      // since we don't set `force`
      status: 404,
    },
    // Serve login page on root
    {
      from: '/',
      to: loginPage,
      status: 401,
      force: true,
    },
    // Redirect to login page otherwise
    {
      from: '/*',
      to: '/',
      status: 302,
      force: true,
    },
  ]

  config.redirects = [...gatedRedirects, ...additionalRedirects]
}

module.exports = {
  // The plugin main logic uses `on...` event handlers that are triggered on
  // each new Netlify Build.
  // Anything can be done inside those event handlers.
  // Information about the current build are passed as arguments. The build
  // configuration file and some core utilities are also available.
  async onBuild({
    // Whole configuration file. For example, content of `netlify.toml`
    netlifyConfig,
    // Build constants
    constants: { PUBLISH_DIR, FUNCTIONS_SRC },
  }) {
    console.log('Copying static assets...')

    await generateSSO({
      config: netlifyConfig,
      functionsDir: FUNCTIONS_SRC,
      publishDir: PUBLISH_DIR,
    })
    const config_out = toml.stringify(netlifyConfig)
    await fs.writeFile(
      path.join(netlifyConfig.build.publish, 'netlify.toml'),
      config_out,
    )
  },
}