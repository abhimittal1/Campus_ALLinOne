import { useEffect, useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'

import { getCameraConfig } from '../../api/cameraApi'

const STATUS_LABELS = {
  empty: 'Not configured',
  error: 'Offline',
  loading: 'Loading',
  online: 'Online',
}

export default function LiveSnapshotPanel({
  title = 'Live Camera',
  description = 'Unified snapshot feed',
  refreshIntervalMs = 3500,
  alt = 'Camera preview',
}) {
  const [cameraUrl, setCameraUrl] = useState('')
  const [snapshotTs, setSnapshotTs] = useState(Date.now())
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    let active = true

    getCameraConfig()
      .then((res) => {
        if (!active) return
        const nextUrl = res.data?.url ?? ''
        setCameraUrl(nextUrl)
        setStatus(nextUrl ? 'loading' : 'empty')
      })
      .catch(() => {
        if (active) setStatus('error')
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!cameraUrl || status === 'error') return undefined

    const id = window.setInterval(() => {
      setSnapshotTs(Date.now())
    }, refreshIntervalMs)

    return () => window.clearInterval(id)
  }, [cameraUrl, refreshIntervalMs, status])

  const refreshPreview = () => {
    setStatus(cameraUrl ? 'loading' : 'empty')
    setSnapshotTs(Date.now())
  }

  const statusClass =
    status === 'online'
      ? 'bg-emerald-100 text-emerald-700'
      : status === 'error'
        ? 'bg-rose-100 text-rose-700'
        : 'bg-slate-100 text-slate-600'

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-800">{title}</p>
          <p className="text-xs text-slate-400 truncate max-w-[420px]">{cameraUrl || description}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusClass}`}>
            {STATUS_LABELS[status]}
          </span>
          <button
            type="button"
            onClick={refreshPreview}
            className="w-9 h-9 inline-flex items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
            aria-label="Refresh preview"
            title="Refresh preview"
          >
            <ArrowPathIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="relative bg-slate-950 aspect-video flex items-center justify-center">
        {cameraUrl ? (
          <img
            src={`/camera/snapshot?t=${snapshotTs}`}
            alt={alt}
            className="w-full h-full object-contain"
            onLoad={() => setStatus('online')}
            onError={() => setStatus('error')}
          />
        ) : null}

        {status !== 'online' && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/85 px-4">
            <p className="text-sm text-slate-300 text-center">
              {status === 'empty' ? 'Camera URL not configured yet.' : 'Camera unavailable.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}