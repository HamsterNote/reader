module.exports = ({ config }) => {
  const isDevelopment = process.env.APP_VARIANT === 'development'

  return {
    ...config,
    name: isDevelopment ? 'Hamster Reader Dev' : config.name,
    scheme: isDevelopment ? 'hamsterreader-dev' : config.scheme,
    ios: {
      ...config.ios,
      // EAS can write the resolved dev ID back to app.json during setup.
      bundleIdentifier: isDevelopment
        ? 'com.hamsternote.reader.dev'
        : 'com.hamsternote.reader'
    },
    plugins: [
      ...(config.plugins ?? []),
      ...(isDevelopment
        ? [
            [
              'expo-dev-client',
              { addGeneratedScheme: false, launchMode: 'launcher' }
            ]
          ]
        : [])
    ]
  }
}
