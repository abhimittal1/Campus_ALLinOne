import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Navbar from './Navbar'

export default function Layout({ module }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar module={module} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Navbar module={module} />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
