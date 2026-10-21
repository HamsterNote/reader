/* eslint-disable @typescript-eslint/no-require-imports -- Metro 配置必须使用 CJS require */
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')
const config = getDefaultConfig(projectRoot)

// Expo 依赖安装在仓库根目录（这个宿主是现有 reader 库的附带应用）。
config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.join(projectRoot, 'node_modules'),
  path.join(workspaceRoot, 'node_modules')
]
config.resolver.disableHierarchicalLookup = false

module.exports = config
