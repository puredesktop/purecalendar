#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = process.cwd()
const MANIFEST_FILE = 'plugin.json'
const PACKAGE_FILE = 'package.json'
const TEXT_FILE_RE = /\.(cjs|css|html|js|json|jsx|mjs|ts|tsx|txt)$/i

const errors = []
const warnings = []
const info = []

const manifest = await readManifest()
const packageJson = await readPackageJson()
const distPath = join(ROOT, 'dist')

if (packageJson) {
  validatePackageJson(packageJson)
}

if (manifest) {
  validateManifest(manifest)
  await validateBridgePermissionUsage(manifest)
}

if (await isDirectory(distPath)) {
  info.push('dist folder is present for static registration.')
} else {
  errors.push('dist folder is required before the app can be registered. Run npm run build first.')
}

if (manifest) {
  await validateAgentSurface(manifest, distPath)
}

for (const message of info) console.log(`ok: ${message}`)
for (const message of warnings) console.warn(`warn: ${message}`)
for (const message of errors) console.error(`error: ${message}`)

if (errors.length > 0) {
  console.error(`\nPureDesktop app validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}.`)
  process.exit(1)
}

console.log('\nPureDesktop app validation passed.')

async function readManifest() {
  return readJsonFile(MANIFEST_FILE)
}

async function readPackageJson() {
  return readJsonFile(PACKAGE_FILE)
}

async function readJsonFile(fileName) {
  const filePath = join(ROOT, fileName)
  if (!existsSync(filePath)) {
    errors.push(`${fileName} is missing.`)
    return null
  }
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    errors.push(`${fileName} could not be read: ${errorMessage(error)}`)
    return null
  }
}

function validatePackageJson(pkg) {
  const scripts = isPlainObject(pkg.scripts) ? pkg.scripts : {}
  requirePackageScript(scripts, 'dev')
  requirePackageScript(scripts, 'build')
  requirePackageScript(scripts, 'typecheck')
  requirePackageScript(scripts, 'puredesktop:check')

  const dependencies = isPlainObject(pkg.dependencies) ? pkg.dependencies : {}
  requireOnePackageDependency(dependencies, [
    '@puredesktop/puredesktop-ui-bridge',
    '@purescience/platform-ui',
  ])
  requirePackageDependency(dependencies, 'react')
  requirePackageDependency(dependencies, 'react-dom')
  requirePackageDependency(dependencies, 'styled-components')

  const devDependencies = isPlainObject(pkg.devDependencies) ? pkg.devDependencies : {}
  requirePackageDependency(devDependencies, '@vitejs/plugin-react-swc')
  requirePackageDependency(devDependencies, 'typescript')
  requirePackageDependency(devDependencies, 'vite')

  if (errors.length === 0) info.push('package.json has the required PureDesktop scripts and dependencies.')
}

function requirePackageScript(scripts, name) {
  if (!nonEmptyString(scripts[name])) {
    errors.push(`package.json scripts.${name} is required.`)
  }
}

function requirePackageDependency(dependencies, name) {
  if (!nonEmptyString(dependencies[name])) {
    errors.push(`package.json must include ${name}.`)
  }
}

function requireOnePackageDependency(dependencies, names) {
  if (names.some(name => nonEmptyString(dependencies[name]))) return
  errors.push(`package.json must include one of: ${names.join(', ')}.`)
}

function validateManifest(manifest) {
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1.')
  if (!nonEmptyString(manifest.id)) errors.push('id is required.')
  if (!nonEmptyString(manifest.name)) errors.push('name is required.')
  if (!isPlainObject(manifest.app)) {
    errors.push('app is required.')
    return
  }
  if (!nonEmptyString(manifest.app.slug)) errors.push('app.slug is required.')
  if (!nonEmptyString(manifest.app.name)) errors.push('app.name is required.')

  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : []
  validateEntrypoint(manifest.entrypoint ?? manifest.app.entrypoint, permissions)

  if (errors.length === 0) info.push('plugin.json is valid.')
}

function validateEntrypoint(entrypoint, permissions) {
  if (!isPlainObject(entrypoint)) {
    errors.push('entrypoint is required.')
    return
  }
  if (entrypoint.kind === 'dev-url') {
    if (!nonEmptyString(entrypoint.url)) {
      errors.push('entrypoint.url is required for dev-url.')
      return
    }
    let url
    try {
      url = new URL(entrypoint.url)
    } catch {
      errors.push('entrypoint.url must be a valid http or https URL.')
      return
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      errors.push('entrypoint.url must use http or https.')
    }
    if (!isLocalHost(url.hostname) && !permissions.includes('network')) {
      errors.push('Non-local entrypoint URLs require the network permission.')
    }
    return
  }
  if (entrypoint.kind === 'built-static') {
    if (!safeRelativeDir(entrypoint.dir)) {
      errors.push('built-static entrypoint.dir must be a safe relative directory.')
    }
    if (entrypoint.dir !== 'dist') {
      warnings.push(`PureDesktop registration packages usually use built-static dir "dist" instead of "${entrypoint.dir}".`)
    }
    return
  }
  errors.push(`Unsupported entrypoint kind: ${String(entrypoint.kind ?? '') || '(missing)'}.`)
}

async function validateBridgePermissionUsage(manifest) {
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : []
  const sourceText = await readProjectText(join(ROOT, 'src'))
  const requirements = [
    {
      permission: 'filesystem',
      hints: [
        '/bridge/storage',
        '/bridge/fs',
        '/bridge/dialog',
        '/bridge/react/usePlatformJsonStore',
      ],
    },
    {
      permission: 'settings',
      hints: [
        '/bridge/appSettings',
        '/bridge/preferences',
        '/bridge/react/usePlatformAppSettings',
        '/bridge/react/usePlatformPreferences',
      ],
    },
    {
      permission: 'network',
      hints: ['/bridge/network'],
    },
  ]

  for (const requirement of requirements) {
    if (permissions.includes(requirement.permission)) continue
    if (!requirement.hints.some(hint => sourceText.includes(hint))) continue
    errors.push(
      `Source imports ${requirement.permission}-gated bridge helpers, so plugin.json must include the ${requirement.permission} permission.`,
    )
  }
}

async function validateAgentSurface(manifest, distPath) {
  const tools = agentTools(manifest)
  const hasAgentsMd = await isFile(join(ROOT, 'agents.md'))
  const hasAgentPermission = manifest.permissions?.includes('agents') === true
  const hasAgentPanel = manifest.app?.usePureDesktopAiPanel === true
  const hasAgentSurface =
    tools.length > 0 || hasAgentsMd || hasAgentPermission || hasAgentPanel

  if (!hasAgentSurface) {
    info.push('No app agent declared.')
    return
  }

  if (hasAgentsMd) {
    info.push('agents.md is present.')
  } else {
    errors.push('agents.md is required when app agent support is enabled.')
  }

  if (hasAgentPermission) {
    info.push('agents permission is enabled.')
  } else {
    errors.push('plugin.json must include the agents permission when app agent support is enabled.')
  }

  if (hasAgentPanel) {
    info.push('app.usePureDesktopAiPanel is true.')
  } else {
    errors.push('plugin.json app.usePureDesktopAiPanel must be true when app agent support is enabled.')
  }

  await validateAgentTools(manifest, distPath, tools)
}

async function validateAgentTools(manifest, distPath, tools) {
  if (!Array.isArray(tools) || tools.length === 0) {
    info.push('No app agent tools declared.')
    return
  }

  if (!manifest.permissions?.includes('agents')) {
    errors.push('app.agents.tools is declared, so plugin.json must include the agents permission.')
  }

  const toolNames = new Set()
  tools.forEach((tool, index) => {
    const label = `app.agents.tools[${index}]`
    const name = typeof tool?.name === 'string' ? tool.name.trim() : ''
    if (!name) {
      errors.push(`${label}.name is required.`)
      return
    }
    if (toolNames.has(name)) errors.push(`Duplicate app agent tool name: ${name}.`)
    toolNames.add(name)
    if (!tool.description?.trim()) errors.push(`${label}.description is required.`)
    if (!isPlainObject(tool.inputSchema)) errors.push(`${label}.inputSchema must be an object.`)
  })

  if (toolNames.size === 0) return

  const manifestToolNames = [...toolNames]
  const sourceText = await readProjectText(join(ROOT, 'src'))
  const distText = await readProjectText(distPath)
  const registrationHints = ['usePlatformAgentTools', 'registerAgentTools', 'agents.tools.register']
  if (!registrationHints.some(hint => sourceText.includes(hint))) {
    errors.push('Declared app agent tools must be registered in source with usePlatformAgentTools or agents.tools.register.')
  }
  const handlerHints = ['handlers:', 'appAgentHandlers', 'AgentToolHandlerResult']
  if (!handlerHints.some(hint => sourceText.includes(hint))) {
    errors.push('Declared app agent tools require source handlers.')
  }

  for (const toolName of manifestToolNames) {
    if (!sourceText.includes(toolName)) {
      errors.push(`Declared app agent tool "${toolName}" was not found in source files.`)
    }
    if (!distText.includes(toolName)) {
      errors.push(`Declared app agent tool "${toolName}" was not found in the built dist output.`)
    }
  }

  if (!errors.some(error => error.includes('app agent tool'))) {
    info.push(`Verified ${toolNames.size} app agent tool${toolNames.size === 1 ? '' : 's'} in source and dist.`)
  }
}

function agentTools(manifest) {
  const tools = manifest.app?.agents?.tools
  return Array.isArray(tools) ? tools : []
}

async function readProjectText(root) {
  const chunks = []
  await collectText(root, chunks)
  return chunks.join('\n')
}

async function collectText(path, chunks) {
  const stats = await stat(path).catch(() => null)
  if (!stats) return
  if (stats.isFile()) {
    if (!TEXT_FILE_RE.test(path)) return
    chunks.push(await readFile(path, 'utf8').catch(() => ''))
    return
  }
  if (!stats.isDirectory()) return
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    await collectText(join(path, entry.name), chunks)
  }
}

async function isFile(path) {
  return stat(path)
    .then(stats => stats.isFile())
    .catch(() => false)
}

async function isDirectory(path) {
  return stat(path)
    .then(stats => stats.isDirectory())
    .catch(() => false)
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function safeRelativeDir(value) {
  if (!nonEmptyString(value)) return false
  const normalized = value.replaceAll('\\', '/')
  return !normalized.startsWith('/') && !normalized.includes('..')
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
