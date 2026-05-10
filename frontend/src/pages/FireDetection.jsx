import { useCallback, useEffect, useState } from 'react'
import {
  ArrowPathIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

import Modal from '../components/ui/Modal'
import StatCard from '../components/ui/StatCard'
import { getCameraConfig } from '../api/cameraApi'
import {
  createFireZone,
  deleteFireZone,
  dismissFireAlert,
  getFireAlertStats,
  getFireAlerts,
  getFireStatus,
  getFireZones,
  getMonitorStatus,
  getZoneSnapshotUrl,
  scanZone,
  startMonitor,
  stopMonitor,
  updateFireZone,
} from '../api/fireApi'

const EMPTY_FORM = { name: '', description: '', camera_url: '', is_active: true }
const ALERT_TABS = ['All', 'Active', 'Dismissed']

function timeAgo(iso) {
  if (!iso) return '—'
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

// ── Zone card ─────────────────────────────────────────────────────────────────

function ZoneCard({ zone, status, onScanNow, onEdit, onDelete }) {
  const [snapshotTs, setSnapshotTs] = useState(Date.now())
  const [snapshotError, setSnapshotError] = useState(false)
  const [scanning, setScanning] = useState(false)

  const statusLevel = status?.status_level ?? (status?.is_alert ? 'alert' : 'normal')
  const isAlert = statusLevel === 'alert'
  const isSuspect = statusLevel === 'suspect'
  const hasError = Boolean(status?.error)
  const showCameraError = hasError || snapshotError
  const currentDetections = (status?.current_detections ?? [])
    .filter((d) => ['fire', 'smoke'].includes(d.label?.toLowerCase()))
    .sort((a, b) => b.confidence - a.confidence)
  const fallbackDetections = (status?.last_alert_detections ?? [])
    .filter((d) => ['fire', 'smoke'].includes(d.label?.toLowerCase()))
    .sort((a, b) => b.confidence - a.confidence)
  const detections = currentDetections.length > 0 || statusLevel === 'normal'
    ? currentDetections
    : fallbackDetections
  const strongestDetection = status?.strongest_detection?.toLowerCase() ?? detections[0]?.label?.toLowerCase()
  const scanFramesSampled = status?.scan_frames_sampled ?? 0
  const matchingVotes = (status?.recent_frame_votes ?? []).filter(
    (vote) => vote.level === 'alert' || vote.level === 'suspect',
  ).length
  const lastChecked = status?.last_checked

  useEffect(() => {
    setSnapshotError(false)
    setSnapshotTs(Date.now())
  }, [zone.camera_url, zone.is_active])

  useEffect(() => {
    if (!zone.is_active || showCameraError) return undefined
    const id = setInterval(() => setSnapshotTs(Date.now()), 4000)
    return () => clearInterval(id)
  }, [zone.is_active, showCameraError])

  const handleScanNow = async () => {
    setScanning(true)
    try {
      await onScanNow(zone.id)
      setSnapshotError(false)
      setSnapshotTs(Date.now())
      toast.success(`Scan complete — ${zone.name}`)
    } catch {
      toast.error('Scan failed')
    } finally {
      setScanning(false)
    }
  }

  let badgeLabel = 'Normal'
  let badgeClass = 'bg-emerald-100 text-emerald-700 border-emerald-200'
  let cardClass = 'border-slate-200'

  if (showCameraError) {
    badgeLabel = 'Camera Offline'
    badgeClass = 'bg-slate-100 text-slate-500 border-slate-200'
  } else if (isAlert) {
    badgeLabel = strongestDetection === 'smoke' ? 'SMOKE DETECTED' : 'FIRE DETECTED'
    badgeClass = 'bg-rose-100 text-rose-700 border-rose-200'
    cardClass = 'border-rose-300 ring-2 ring-rose-400/60'
  } else if (isSuspect) {
    badgeLabel = strongestDetection === 'smoke' ? 'Suspected Smoke' : 'Suspected Fire'
    badgeClass = 'bg-amber-100 text-amber-700 border-amber-200'
    cardClass = 'border-amber-300 ring-2 ring-amber-300/70'
  }

  const statusLineParts = []
  if (scanFramesSampled > 0) {
    statusLineParts.push(`${matchingVotes}/${scanFramesSampled} frames matched`)
  }
  if (lastChecked) {
    statusLineParts.push(`Scanned ${timeAgo(lastChecked)}`)
  }
  const statusLine = statusLineParts.length > 0 ? statusLineParts.join(' • ') : 'Not yet scanned'

  return (
    <div
      className={`bg-white rounded-[2rem] border shadow-sm overflow-hidden transition-all duration-300 ${cardClass}`}
    >
      {/* Snapshot area */}
      <div className="relative aspect-video bg-slate-100 overflow-hidden">
        {zone.is_active && !showCameraError ? (
          <img
            key={snapshotTs}
            src={`${getZoneSnapshotUrl(zone.id)}?t=${snapshotTs}`}
            alt={zone.name}
            className="w-full h-full object-cover"
            onLoad={() => setSnapshotError(false)}
            onError={() => setSnapshotError(true)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-400">
            <ExclamationTriangleIcon className="w-10 h-10 opacity-40" />
            <p className="text-xs text-center px-4">
              {zone.is_active
                ? (status?.error ?? 'Camera snapshot unavailable. Check URL/reachability.')
                : 'Zone inactive'}
            </p>
          </div>
        )}

        {isAlert && (
          <div className="absolute inset-0 border-4 border-rose-500 animate-pulse pointer-events-none" />
        )}

        {isSuspect && !isAlert && (
          <div className="absolute inset-0 border-4 border-amber-400/90 pointer-events-none" />
        )}

        <span
          className={`absolute top-3 right-3 text-xs font-semibold px-2.5 py-1 rounded-full border ${badgeClass}`}
        >
          {badgeLabel}
        </span>

        {!zone.is_active && (
          <span className="absolute top-3 left-3 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-800/80 text-white">
            Inactive
          </span>
        )}
      </div>

      {/* Card body */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 truncate">{zone.name}</h3>
            {zone.description && (
              <p className="text-xs text-slate-500 mt-0.5 truncate">{zone.description}</p>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => onEdit(zone)}
              className="w-8 h-8 inline-flex items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors"
              title="Edit zone"
            >
              <PencilIcon className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onDelete(zone)}
              className="w-8 h-8 inline-flex items-center justify-center rounded-xl border border-rose-100 text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
              title="Delete zone"
            >
              <TrashIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {detections.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {detections.slice(0, 3).map((d, i) => {
              const isFire = d.label?.toLowerCase() === 'fire'
              const isAlertDetection = d.level === 'alert'
              const labelClass = isAlertDetection
                ? isFire
                  ? 'text-rose-600'
                  : 'text-amber-600'
                : 'text-amber-600'
              const barClass = isAlertDetection
                ? isFire
                  ? 'bg-rose-500'
                  : 'bg-amber-500'
                : 'bg-amber-400'
              return (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className={`w-14 font-medium shrink-0 ${labelClass}`}>
                    {d.label}
                  </span>
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barClass}`}
                      style={{ width: `${Math.round(d.confidence * 100)}%` }}
                    />
                  </div>
                  <span className="text-slate-500 tabular-nums w-8 text-right">
                    {Math.round(d.confidence * 100)}%
                  </span>
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400 truncate">{statusLine}</p>
          <button
            onClick={handleScanNow}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-700 disabled:opacity-50 transition-colors shrink-0"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            Scan Now
          </button>
        </div>
      </div>
    </div>
  )
  
}

// ── Zone form modal ───────────────────────────────────────────────────────────

function ZoneFormModal({ open, onClose, editingZone, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (editingZone) {
      setForm({
        name: editingZone.name,
        description: editingZone.description ?? '',
        camera_url: editingZone.camera_url ?? '',
        is_active: editingZone.is_active,
      })
    } else {
      setForm(EMPTY_FORM)
      // Pre-fill from global camera URL set in .env
      getCameraConfig()
        .then((res) => setForm((f) => ({ ...f, camera_url: res.data?.url ?? '' })))
        .catch(() => {})
    }
  }, [open, editingZone])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error('Zone Name is required')
      return
    }
    setSaving(true)
    try {
      if (editingZone) {
        const res = await updateFireZone(editingZone.id, form)
        onSaved('update', res.data)
        toast.success('Zone updated')
      } else {
        const res = await createFireZone(form)
        onSaved('create', res.data)
        toast.success('Zone added')
      }
      onClose()
    } catch (err) {
      toast.error(err?.response?.data?.detail ?? 'Failed to save zone')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editingZone ? 'Edit Zone' : 'Add Camera Zone'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Zone Name <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Chemistry Lab"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Optional — e.g. Ground floor, Block B"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Camera URL
            <span className="ml-2 text-xs font-normal text-slate-400">(leave blank to use .env CAMERA_URL)</span>
          </label>
          <input
            type="text"
            value={form.camera_url}
            onChange={(e) => setForm((f) => ({ ...f, camera_url: e.target.value }))}
            placeholder="Pre-filled from CAMERA_URL in .env — override per zone if needed"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 font-mono"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
            className={`relative inline-flex w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none ${
              form.is_active ? 'bg-emerald-500' : 'bg-slate-300'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
                form.is_active ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
          <span className="text-sm text-slate-700">{form.is_active ? 'Active' : 'Inactive'}</span>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 disabled:opacity-60 transition-colors"
          >
            {saving ? 'Saving…' : editingZone ? 'Save Changes' : 'Add Zone'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FireDetection() {
  const [zones, setZones] = useState([])
  const [zoneStatuses, setZoneStatuses] = useState({})
  const [alerts, setAlerts] = useState([])
  const [stats, setStats] = useState({
    active_zones: 0,
    alerts_today: 0,
    fire_count_today: 0,
    smoke_count_today: 0,
  })
  const [monitor, setMonitor] = useState({ is_monitoring: false, last_scan_at: null, zones_count: 0 })
  const [monitorToggling, setMonitorToggling] = useState(false)

  const [alertTab, setAlertTab] = useState('All')
  const [loading, setLoading] = useState(true)

  const [zoneModalOpen, setZoneModalOpen] = useState(false)
  const [editingZone, setEditingZone] = useState(null)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // ── Initial load ─────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([getFireZones(), getFireAlertStats(), getMonitorStatus(), getFireAlerts()])
      .then(([zonesRes, statsRes, monRes, alertsRes]) => {
        setZones(zonesRes.data)
        setStats(statsRes.data)
        setMonitor(monRes.data)
        setAlerts(alertsRes.data)
      })
      .catch(() => toast.error('Failed to load fire detection data'))
      .finally(() => setLoading(false))
  }, [])

  // ── Poll zone statuses every 3 s ─────────────────────────────────────────
  useEffect(() => {
    const poll = () =>
      getFireStatus()
        .then((res) => {
          const map = {}
          res.data.forEach((s) => { map[s.zone_id] = s })
          setZoneStatuses(map)
        })
        .catch(() => {})
    poll()
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [])

  // ── Poll stats + monitor status every 5 s ────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      getFireAlertStats().then((r) => setStats(r.data)).catch(() => {})
      getMonitorStatus().then((r) => setMonitor(r.data)).catch(() => {})
    }, 5000)
    return () => clearInterval(id)
  }, [])

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleScanNow = useCallback(async (zoneId) => {
    const res = await scanZone(zoneId)
    setZoneStatuses((prev) => ({ ...prev, [zoneId]: res.data }))
    getFireAlerts().then((r) => setAlerts(r.data)).catch(() => {})
    getFireAlertStats().then((r) => setStats(r.data)).catch(() => {})
  }, [])

  const handleMonitorToggle = async () => {
    setMonitorToggling(true)
    try {
      if (monitor.is_monitoring) {
        await stopMonitor()
        toast('Monitor stopped', { icon: '⏹' })
      } else {
        await startMonitor()
        toast.success('Background monitor started')
      }
      const res = await getMonitorStatus()
      setMonitor(res.data)
    } catch {
      toast.error('Failed to toggle monitor')
    } finally {
      setMonitorToggling(false)
    }
  }

  const handleZoneSaved = (action, zone) => {
    setZones((prev) =>
      action === 'create' ? [zone, ...prev] : prev.map((z) => (z.id === zone.id ? zone : z)),
    )
  }

  const openEdit = (zone) => {
    setEditingZone(zone)
    setZoneModalOpen(true)
  }

  const openAdd = () => {
    setEditingZone(null)
    setZoneModalOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteFireZone(deleteTarget.id)
      setZones((prev) => prev.filter((z) => z.id !== deleteTarget.id))
      setDeleteTarget(null)
      toast.success('Zone deleted')
    } catch {
      toast.error('Failed to delete zone')
    } finally {
      setDeleting(false)
    }
  }

  const handleDismiss = async (alertId) => {
    try {
      await dismissFireAlert(alertId)
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, is_dismissed: true } : a)))
      getFireAlertStats().then((r) => setStats(r.data)).catch(() => {})
      toast.success('Alert dismissed')
    } catch {
      toast.error('Failed to dismiss alert')
    }
  }

  const filteredAlerts = alerts.filter((a) => {
    if (alertTab === 'Active') return !a.is_dismissed
    if (alertTab === 'Dismissed') return a.is_dismissed
    return true
  })

  const activeAlertCount = alerts.filter((a) => !a.is_dismissed).length

  return (
    <div className="space-y-8">

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="rounded-[2rem] bg-gradient-to-br from-rose-50 via-white to-orange-50 border border-rose-200 p-7">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-rose-600">Fire Detection</p>
            <h1 className="mt-3 text-3xl font-bold text-slate-900">
              Campus fire &amp; smoke monitoring
            </h1>
            <p className="mt-3 text-sm text-slate-600 max-w-2xl leading-6">
              Add camera zones for each college area. Run on-demand scans or start the continuous
              background monitor — YOLOv8 analyses every feed and raises alerts automatically.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border ${
                monitor.is_monitoring
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-slate-50 text-slate-500 border-slate-200'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  monitor.is_monitoring ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'
                }`}
              />
              {monitor.is_monitoring ? 'Monitoring Active' : 'Monitor Off'}
            </span>

            <button
              onClick={handleMonitorToggle}
              disabled={monitorToggling}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-semibold transition-colors disabled:opacity-60 ${
                monitor.is_monitoring
                  ? 'bg-rose-600 text-white hover:bg-rose-700'
                  : 'bg-slate-900 text-white hover:bg-slate-700'
              }`}
            >
              {monitorToggling ? (
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
              ) : monitor.is_monitoring ? (
                <StopIcon className="w-4 h-4" />
              ) : (
                <PlayIcon className="w-4 h-4" />
              )}
              {monitor.is_monitoring ? 'Stop Monitor' : 'Start Monitor'}
            </button>

            <button
              onClick={openAdd}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 text-white px-5 py-2.5 text-sm font-semibold hover:bg-slate-700 transition-colors"
            >
              <PlusIcon className="w-4 h-4" />
              Add Zone
            </button>
          </div>
        </div>
      </section>

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Active Zones"
          value={loading ? '…' : stats.active_zones}
          colorClass="bg-slate-800"
        />
        <StatCard
          title="Alerts Today"
          value={loading ? '…' : stats.alerts_today}
          subtitle={`${activeAlertCount} unreviewed`}
          colorClass="bg-rose-500"
        />
        <StatCard
          title="Fire Detections"
          value={loading ? '…' : stats.fire_count_today}
          subtitle="today"
          colorClass="bg-rose-700"
        />
        <StatCard
          title="Smoke Detections"
          value={loading ? '…' : stats.smoke_count_today}
          subtitle="today"
          colorClass="bg-amber-500"
        />
      </div>

      {/* ── Zone grid ───────────────────────────────────────────────────── */}
      <section className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Camera Zones</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {zones.length === 0
                ? 'No zones configured yet'
                : `${zones.length} zone${zones.length !== 1 ? 's' : ''} — snapshots refresh every 4 s`}
            </p>
          </div>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <PlusIcon className="w-4 h-4" />
            Add Zone
          </button>
        </div>

        {zones.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-rose-50 flex items-center justify-center mb-4">
              <ExclamationTriangleIcon className="w-8 h-8 text-rose-400" />
            </div>
            <p className="text-slate-700 font-medium">No camera zones added yet</p>
            <p className="text-slate-500 text-sm mt-1 mb-5">
              Add a zone for each college area you want to monitor.
            </p>
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 transition-colors"
            >
              <PlusIcon className="w-4 h-4" />
              Add First Zone
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {zones.map((zone) => (
              <ZoneCard
                key={zone.id}
                zone={zone}
                status={zoneStatuses[zone.id] ?? null}
                onScanNow={handleScanNow}
                onEdit={openEdit}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Alert history ───────────────────────────────────────────────── */}
      <section className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Alert History</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Recent fire and smoke detection events across all zones
            </p>
          </div>

          <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
            {ALERT_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setAlertTab(tab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  alertTab === tab
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab}
                {tab === 'Active' && activeAlertCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] leading-none">
                    {activeAlertCount > 9 ? '9+' : activeAlertCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {filteredAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14">
            <CheckIcon className="w-10 h-10 text-emerald-400 mb-3" />
            <p className="text-slate-500 text-sm">
              {alertTab === 'Active' ? 'No active alerts — all clear' : 'No alerts to show'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Zone</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Confidence</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredAlerts.map((alert) => {
                  const isFire = alert.detection_type === 'fire'
                  return (
                    <tr key={alert.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{alert.zone_name}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
                            isFire
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}
                        >
                          {isFire ? '🔥' : '💨'}{' '}
                          {alert.detection_type.charAt(0).toUpperCase() + alert.detection_type.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${isFire ? 'bg-rose-500' : 'bg-amber-500'}`}
                              style={{ width: `${Math.round(alert.confidence * 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-600 tabular-nums">
                            {Math.round(alert.confidence * 100)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">{timeAgo(alert.created_at)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            alert.is_dismissed
                              ? 'bg-slate-100 text-slate-500'
                              : 'bg-rose-50 text-rose-600 border border-rose-200'
                          }`}
                        >
                          {alert.is_dismissed ? 'Dismissed' : 'Active'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {!alert.is_dismissed && (
                          <button
                            onClick={() => handleDismiss(alert.id)}
                            className="text-xs px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors font-medium"
                          >
                            Dismiss
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Zone Add / Edit Modal ──────────────────────────────────────── */}
      <ZoneFormModal
        open={zoneModalOpen}
        onClose={() => setZoneModalOpen(false)}
        editingZone={editingZone}
        onSaved={handleZoneSaved}
      />

      {/* ── Delete confirmation ────────────────────────────────────────── */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Zone">
        <p className="text-sm text-slate-600 mb-5">
          Are you sure you want to delete{' '}
          <strong className="text-slate-900">{deleteTarget?.name}</strong>? All alert history for
          this zone will be permanently removed.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setDeleteTarget(null)}
            className="flex-1 px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDeleteConfirm}
            disabled={deleting}
            className="flex-1 px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-60 transition-colors"
          >
            {deleting ? 'Deleting…' : 'Delete Zone'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
