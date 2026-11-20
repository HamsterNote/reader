module.exports = ({ config }) => {
  const isDevelopment = process.env.APP_VARIANT === 'development'

  return {
    ...config,
    name: isDevelopment ? 'Hamster Reader Dev' : config.name,
    scheme: isDevelopment ? 'hamsterreader-dev' : config.scheme,
    ios: {
      ...config.ios,
      // Both profiles reuse the existing ad-hoc signing identity.
      bundleIdentifier: 'com.hamsternote.reader',
      buildNumber: isDevelopment ? '2' : config.ios.buildNumber
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
