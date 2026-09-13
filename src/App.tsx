import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import MonitorPage from './pages/MonitorPage'
import AiPlanPage from './pages/AiPlanPage'
import AiPlanWizardPage from './pages/AiPlanWizardPage'
import WorkflowsPage from './pages/WorkflowsPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        {/* 首頁 = 監控 Dashboard */}
        <Route path="/" element={<MonitorPage />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/workflows/ai-plan" element={<AiPlanWizardPage />} />
        <Route
          path="/workflows/:workflowCode/plan"
          element={<AiPlanPage />}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
