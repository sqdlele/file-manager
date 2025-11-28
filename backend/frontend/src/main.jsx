import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Error Boundary для перехвата ошибок
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught by boundary:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ 
          padding: '20px', 
          background: '#1e1e1e', 
          color: '#ffffff', 
          minHeight: '100vh',
          fontFamily: 'Segoe UI, sans-serif'
        }}>
          <h2 style={{ color: '#d13438' }}>Произошла ошибка</h2>
          <p>{this.state.error?.message || 'Неизвестная ошибка'}</p>
          <button 
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 16px',
              background: '#0078d4',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              marginTop: '16px'
            }}
          >
            Перезагрузить страницу
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

try {
  const root = createRoot(document.getElementById('root'))
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
} catch (error) {
  console.error('Failed to render app:', error)
  const rootEl = document.getElementById('root')
  if (rootEl) {
    rootEl.innerHTML = `
      <div style="padding: 20px; background: #1e1e1e; color: #ffffff; min-height: 100vh; font-family: 'Segoe UI', sans-serif;">
        <h2 style="color: #d13438;">Критическая ошибка</h2>
        <p>Не удалось загрузить приложение. Проверьте консоль браузера.</p>
        <button onclick="window.location.reload()" style="padding: 8px 16px; background: #0078d4; color: #ffffff; border: none; border-radius: 4px; cursor: pointer; margin-top: 16px;">
          Перезагрузить страницу
        </button>
      </div>
    `
  }
}
