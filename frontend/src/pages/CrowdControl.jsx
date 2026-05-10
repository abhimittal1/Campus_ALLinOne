import LiveSnapshotPanel from '../components/camera/LiveSnapshotPanel'
import StatCard from '../components/ui/StatCard'

const ZONES = [
  { name: 'North Gate', people: 46, density: 'High', densityClass: 'bg-amber-50 text-amber-700' },
  { name: 'Library Atrium', people: 19, density: 'Normal', densityClass: 'bg-emerald-50 text-emerald-700' },
  { name: 'Workshop Hall', people: 27, density: 'Watch', densityClass: 'bg-cyan-50 text-cyan-700' },
]

export default function CrowdControl() {
  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] bg-gradient-to-br from-cyan-50 via-white to-sky-50 border border-cyan-200 p-7">
        <p className="text-xs uppercase tracking-[0.35em] text-cyan-600">Crowd Control</p>
        <h1 className="mt-3 text-3xl font-bold text-slate-900">Operational view for crowd density and footfall thresholds.</h1>
        <p className="mt-3 text-sm text-slate-600 max-w-2xl leading-6">
          This UI is ready to consume live people-count detections and threshold alerts. The next backend step will attach local vision inference and persisted crowd events.
        </p>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Current People Count" value={92} colorClass="bg-cyan-500" />
        <StatCard title="Zones in Watch State" value={2} colorClass="bg-amber-500" />
        <StatCard title="Alerts Today" value={4} subtitle="2 threshold breaches" colorClass="bg-slate-800" />
      </div>

      <section className="grid xl:grid-cols-[1.15fr_0.85fr] gap-6">
        <LiveSnapshotPanel
          title="Crowd Monitoring Feed"
          description="Shared camera stream used for live occupancy estimation"
          alt="Crowd monitoring camera"
        />

        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6 space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Zone density</h2>
            <p className="text-sm text-slate-500">Designed for the crowd-control backend that will compute count and density per zone.</p>
          </div>
          <div className="space-y-3">
            {ZONES.map((zone) => (
              <div key={zone.name} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{zone.name}</p>
                    <p className="text-sm text-slate-500">{zone.people} people detected</p>
                  </div>
                  <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${zone.densityClass}`}>
                    {zone.density}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}