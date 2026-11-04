module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== 'development') return config

  return {
    ...config,
    name: 'Hamster Reader Dev',
    scheme: 'hamsterreader-dev',
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.hamsternote.reader.dev'
    },
    plugins: [
      ...(config.plugins ?? []),
      ['expo-dev-client', { addGeneratedScheme: false, launchMode: 'launcher' }]
    ]
  }
}
