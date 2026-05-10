import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { getCameraConfig, updateCameraConfig } from '../api/cameraApi'
import { useAuth } from '../hooks/useAuth'

export default function CameraSettings() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [url, setUrl] = useState('')
  const [saved, setSaved] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getCameraConfig()
      .then((r) => {
        setUrl(r.data.url)
        setSaved(r.data.url)
      })
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await updateCameraConfig(url)
      setSaved(url)
      toast.success('Camera URL updated')
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>

  return (
    <div className="space-y-6 max-w-lg">
      <h1 className="text-2xl font-bold text-gray-800">Camera Settings</h1>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
        <div>
          <p className="text-sm text-gray-500 mb-1">Current URL</p>
          <p className="font-mono text-sm text-gray-800 break-all bg-gray-50 px-3 py-2 rounded-lg">
            {saved}
          </p>
        </div>

        {isAdmin ? (
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New Camera URL</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={saving || url === saved}
              className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-60 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </form>
        ) : (
          <p className="text-sm text-amber-600">Only admins can change the camera URL.</p>
        )}
      </div>
    </div>
  )
}
