import { useCallback, useEffect, useMemo, useState } from 'react'
import { FolderOpen, FolderPlus, Power, RefreshCw, RotateCcw, Save, Trash2 } from 'lucide-react'
import type { PluginConfig, PluginConfigField, PluginConfigValue, PluginInfo, PluginSettings, PluginStatus } from '@shared/plugins'
import { useI18n, type TFunction } from '../i18n'
import { syncRendererPlugins } from '../plugins/plugin-runtime'

function pluginDisplayName(plugin: PluginInfo): string {
  return plugin.manifest?.name ?? plugin.id
}

function pluginPermissions(plugin: PluginInfo): string[] {
  const permissions = new Set(plugin.manifest?.permissions ?? [])
  for (const node of plugin.manifest?.nodes ?? []) {
    for (const permission of node.permissions) permissions.add(permission)
  }
  return [...permissions]
}

function defaultConfigValue(field: PluginConfigField): PluginConfigValue {
  if (field.default !== undefined) return field.default
  if (field.type === 'boolean') return false
  if (field.type === 'number') return field.min ?? 0
  if (field.type === 'select') return field.options[0]?.value ?? ''
  return ''
}

function pluginConfigDraft(plugin: PluginInfo): PluginConfig {
  const draft: PluginConfig = {}

  for (const field of plugin.manifest?.configuration ?? []) {
    draft[field.id] = plugin.config[field.id] ?? defaultConfigValue(field)
  }

  return draft
}

function configFingerprint(config: PluginConfig): string {
  return JSON.stringify(Object.entries(config).sort(([first], [second]) => first.localeCompare(second)))
}

function fieldValue(draft: PluginConfig, field: PluginConfigField): PluginConfigValue {
  return draft[field.id] ?? defaultConfigValue(field)
}

function pluginStatusLabel(status: PluginStatus, t: TFunction): string {
  return t(`plugin.status.${status}`)
}

type PluginSettingsPanelProps = {
  active: boolean
}

export function PluginSettingsPanel({ active }: PluginSettingsPanelProps): JSX.Element {
  const { t } = useI18n()
  const [settings, setSettings] = useState<PluginSettings | null>(null)
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null)
  const [configDraft, setConfigDraft] = useState<PluginConfig>({})
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const sortedPlugins = useMemo(
    () => [...plugins].sort((first, second) => pluginDisplayName(first).localeCompare(pluginDisplayName(second))),
    [plugins]
  )
  const selectedPlugin = useMemo(
    () => sortedPlugins.find((plugin) => plugin.id === selectedPluginId) ?? sortedPlugins[0] ?? null,
    [selectedPluginId, sortedPlugins]
  )
  const selectedConfigFields = selectedPlugin?.manifest?.configuration ?? []
  const selectedConfig = selectedPlugin ? pluginConfigDraft(selectedPlugin) : {}
  const configDirty = selectedPlugin ? configFingerprint(configDraft) !== configFingerprint(selectedConfig) : false

  const loadPlugins = useCallback(async (force = false) => {
    setError(null)
    const [nextSettings, nextPlugins] = await Promise.all([window.atlas.plugins.getSettings(), syncRendererPlugins({ force })])
    setSettings(nextSettings)
    setPlugins(nextPlugins)
    setSelectedPluginId((currentId) => (currentId && nextPlugins.some((plugin) => plugin.id === currentId) ? currentId : nextPlugins[0]?.id ?? null))
  }, [])

  useEffect(() => {
    if (!active) return
    void loadPlugins().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : t('plugin.failedLoadSettings'))
    })
  }, [active, loadPlugins, t])

  useEffect(() => {
    setConfigDraft(selectedPlugin ? pluginConfigDraft(selectedPlugin) : {})
  }, [selectedPlugin?.id, selectedPlugin?.updatedAt])

  const runAction = async (actionId: string, action: () => Promise<unknown>) => {
    setBusyAction(actionId)
    setError(null)
    try {
      await action()
      await loadPlugins(true)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('plugin.actionFailed'))
    } finally {
      setBusyAction(null)
    }
  }

  const chooseRootDirectory = () =>
    runAction('choose-root', async () => {
      const rootPath = await window.atlas.filesystem.chooseDirectory(t('plugin.chooseRootTitle'))
      if (rootPath) await window.atlas.plugins.setRootDirectory(rootPath)
    })
  const revealRootDirectory = () =>
    settings ? runAction('reveal-root', () => window.atlas.filesystem.revealInFolder(settings.rootPath, settings.rootPath)) : undefined
  const scanRootDirectory = () => runAction('scan-root', () => window.atlas.plugins.scanRootDirectory())
  const installPlugin = () => runAction('install', () => window.atlas.plugins.installDirectory(undefined, t('plugin.installTitle')))
  const togglePlugin = (plugin: PluginInfo) =>
    runAction(`${plugin.enabled ? 'disable' : 'enable'}:${plugin.id}`, () =>
      plugin.enabled ? window.atlas.plugins.disable(plugin.id) : window.atlas.plugins.enable(plugin.id)
    )
  const reloadPlugin = (plugin: PluginInfo) => runAction(`reload:${plugin.id}`, () => window.atlas.plugins.reload(plugin.id))
  const uninstallPlugin = (plugin: PluginInfo) => runAction(`uninstall:${plugin.id}`, () => window.atlas.plugins.uninstall(plugin.id))
  const savePluginConfig = (plugin: PluginInfo) => runAction(`config:${plugin.id}`, () => window.atlas.plugins.updateConfig(plugin.id, configDraft))

  const updateDraftField = (field: PluginConfigField, value: PluginConfigValue) => {
    setConfigDraft((current) => ({ ...current, [field.id]: value }))
  }

  const isSelectedBusy = selectedPlugin ? (busyAction?.endsWith(`:${selectedPlugin.id}`) ?? false) : false

  return (
    <div className="plugin-settings">
      <div className="plugin-settings__root">
        <label className="plugin-settings__root-field">
          <span>{t('plugin.pluginRoot')}</span>
          <input type="text" readOnly value={settings?.rootPath ?? ''} aria-label={t('plugin.rootDirectory')} />
        </label>
        <div className="plugin-settings__toolbar">
          <button type="button" className="tool-button" disabled={Boolean(busyAction)} onClick={() => void chooseRootDirectory()}>
            <FolderPlus size={16} />
            <span>{t('common.browse')}</span>
          </button>
          <button type="button" className="tool-button" disabled={Boolean(busyAction) || !settings} onClick={() => void revealRootDirectory()}>
            <FolderOpen size={16} />
            <span>{t('common.reveal')}</span>
          </button>
          <button type="button" className="tool-button" disabled={Boolean(busyAction)} onClick={() => void scanRootDirectory()}>
            <RefreshCw size={16} />
            <span>{t('common.scan')}</span>
          </button>
          <button type="button" className="tool-button" disabled={Boolean(busyAction)} onClick={() => void installPlugin()}>
            <FolderPlus size={16} />
            <span>{t('plugin.addFolder')}</span>
          </button>
        </div>
      </div>

      {error ? <div className="plugin-settings__error">{error}</div> : null}

      <div className="plugin-settings__body">
        <aside className="plugin-settings__list" aria-label={t('plugin.plugins')}>
          {sortedPlugins.length === 0 ? (
            <div className="plugin-settings__empty">{t('plugin.noPlugins')}</div>
          ) : (
            sortedPlugins.map((plugin) => (
              <button
                key={plugin.id}
                type="button"
                className={[
                  'plugin-settings__plugin-row',
                  plugin.enabled ? 'plugin-settings__plugin-row--enabled' : 'plugin-settings__plugin-row--disabled',
                  selectedPlugin?.id === plugin.id ? 'plugin-settings__plugin-row--selected' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSelectedPluginId(plugin.id)}
              >
                <span>{pluginDisplayName(plugin)}</span>
                <span className={`plugin-settings__status plugin-settings__status--${plugin.status}`}>{pluginStatusLabel(plugin.status, t)}</span>
              </button>
            ))
          )}
        </aside>

        <section className="plugin-settings__detail">
          {selectedPlugin ? (
            <>
              <div className="plugin-settings__title-row">
                <div>
                  <strong>{pluginDisplayName(selectedPlugin)}</strong>
                  <div className="plugin-settings__meta">
                    <span>{selectedPlugin.id}</span>
                    {selectedPlugin.manifest ? <span>v{selectedPlugin.manifest.version}</span> : null}
                  </div>
                </div>
                <span className={`plugin-settings__status plugin-settings__status--${selectedPlugin.status}`}>
                  {pluginStatusLabel(selectedPlugin.status, t)}
                </span>
              </div>

              {selectedPlugin.manifest?.description ? <p>{selectedPlugin.manifest.description}</p> : null}

              <div className="plugin-settings__meta">
                <span>{selectedPlugin.sourcePath}</span>
              </div>

              {selectedPlugin.manifest?.nodes.length ? (
                <div className="plugin-settings__tokens">
                  {selectedPlugin.manifest.nodes.map((node) => (
                    <span key={node.id}>{node.title}</span>
                  ))}
                </div>
              ) : null}

              {pluginPermissions(selectedPlugin).length > 0 ? (
                <div className="plugin-settings__permissions">
                  {pluginPermissions(selectedPlugin).map((permission) => (
                    <span key={permission}>{permission}</span>
                  ))}
                </div>
              ) : null}

              <div className="plugin-settings__actions">
                <button type="button" className="tool-button" disabled={isSelectedBusy} onClick={() => void togglePlugin(selectedPlugin)}>
                  <Power size={16} />
                  <span>{selectedPlugin.enabled ? t('common.disable') : t('common.enable')}</span>
                </button>
                <button type="button" className="tool-button" disabled={isSelectedBusy} onClick={() => void reloadPlugin(selectedPlugin)}>
                  <RefreshCw size={16} />
                  <span>{t('common.reload')}</span>
                </button>
                <button type="button" className="tool-button danger" disabled={isSelectedBusy} onClick={() => void uninstallPlugin(selectedPlugin)}>
                  <Trash2 size={16} />
                  <span>{t('common.remove')}</span>
                </button>
              </div>

              <section className="plugin-settings__config">
                <div className="plugin-settings__section-title">
                  <strong>{t('plugin.pluginSettings')}</strong>
                  <div className="plugin-settings__actions">
                    <button
                      type="button"
                      className="tool-button"
                      disabled={selectedConfigFields.length === 0 || Boolean(busyAction)}
                      onClick={() => setConfigDraft(pluginConfigDraft({ ...selectedPlugin, config: {} }))}
                    >
                      <RotateCcw size={16} />
                      <span>{t('common.defaults')}</span>
                    </button>
                    <button
                      type="button"
                      className="tool-button primary"
                      disabled={!configDirty || selectedConfigFields.length === 0 || Boolean(busyAction)}
                      onClick={() => void savePluginConfig(selectedPlugin)}
                    >
                      <Save size={16} />
                      <span>{t('common.save')}</span>
                    </button>
                  </div>
                </div>

                {selectedConfigFields.length === 0 ? (
                  <div className="plugin-settings__empty">{t('plugin.noSettings')}</div>
                ) : (
                  <div className="plugin-settings__fields">
                    {selectedConfigFields.map((field) => (
                      <label key={field.id} className="plugin-settings__field">
                        <span>{field.label}</span>
                        {field.type === 'boolean' ? (
                          <input
                            type="checkbox"
                            checked={fieldValue(configDraft, field) === true}
                            onChange={(event) => updateDraftField(field, event.currentTarget.checked)}
                          />
                        ) : null}
                        {field.type === 'number' ? (
                          <input
                            type="number"
                            value={Number(fieldValue(configDraft, field))}
                            min={field.min}
                            max={field.max}
                            step={field.step ?? 1}
                            onChange={(event) => {
                              const value = Number(event.currentTarget.value)
                              if (Number.isFinite(value)) updateDraftField(field, value)
                            }}
                          />
                        ) : null}
                        {field.type === 'select' ? (
                          <select value={String(fieldValue(configDraft, field))} onChange={(event) => updateDraftField(field, event.currentTarget.value)}>
                            {field.options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        {field.type === 'string' ? (
                          <input
                            type="text"
                            value={String(fieldValue(configDraft, field))}
                            placeholder={field.placeholder}
                            onChange={(event) => updateDraftField(field, event.currentTarget.value)}
                          />
                        ) : null}
                        {field.description ? <small>{field.description}</small> : null}
                      </label>
                    ))}
                  </div>
                )}
              </section>

              {selectedPlugin.diagnostics.length > 0 ? (
                <details className="plugin-settings__diagnostics">
                  <summary>{t('plugin.diagnostics')}</summary>
                  <ul>
                    {selectedPlugin.diagnostics.slice(-5).map((entry) => (
                      <li key={`${entry.timestamp}:${entry.message}`}>
                        <span>{entry.level}</span>
                        <code>{entry.message}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : (
            <div className="plugin-settings__empty">{t('plugin.noPluginSelected')}</div>
          )}
        </section>
      </div>
    </div>
  )
}
