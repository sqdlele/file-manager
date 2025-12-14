import { useState, useEffect, useRef } from 'react'
import * as signalR from '@microsoft/signalr'
import './App.css'

const API_URL = '/api/tasks'
const NOTIFICATIONS_API_URL = '/api/notifications'
const HUB_URL = '/taskhub'

function App() {
  const [tasks, setTasks] = useState([])
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [activeTab, setActiveTab] = useState('tasks') // 'tasks' или 'notifications'
  const [connection, setConnection] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [notificationSearchQuery, setNotificationSearchQuery] = useState('')
  const [expandedNotifications, setExpandedNotifications] = useState(new Set())
  const [selectedTaskId, setSelectedTaskId] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [detailsTask, setDetailsTask] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newTask, setNewTask] = useState({
    name: '',
    type: 'alarm',
    parameters: {}
  })

  const connectionRef = useRef(null)
  const shownNotificationsRef = useRef(new Set())

  const loadTasks = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(API_URL)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const data = await response.json()
      // Убеждаемся, что данные - это массив
      const tasksArray = Array.isArray(data) ? data : []
      // Фильтруем невалидные задачи
      const validTasks = tasksArray.filter(t => t && t.id)
      setTasks(validTasks)
    } catch (error) {
      console.error('Error loading tasks:', error)
      setError('Не удалось загрузить задачи. Убедитесь, что backend запущен.')
      setTasks([])
    } finally {
      setLoading(false)
    }
  }

  const loadNotifications = async () => {
    try {
      const response = await fetch(NOTIFICATIONS_API_URL)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const data = await response.json()
      const notificationsArray = Array.isArray(data) ? data : []
      setNotifications(notificationsArray)
      
      // Загружаем счетчик непрочитанных
      const countResponse = await fetch(`${NOTIFICATIONS_API_URL}/unread/count`)
      if (countResponse.ok) {
        const countData = await countResponse.json()
        setUnreadCount(countData.count || 0)
      }
    } catch (error) {
      console.error('Error loading notifications:', error)
    }
  }

  const markAsRead = async (notificationId) => {
    try {
      const response = await fetch(`${NOTIFICATIONS_API_URL}/${notificationId}/read`, {
        method: 'POST'
      })
      if (response.ok) {
        setNotifications(prev => prev.map(n => 
          n.id === notificationId ? { ...n, isRead: true } : n
        ))
        setUnreadCount(prev => Math.max(0, prev - 1))
      }
    } catch (error) {
      console.error('Error marking notification as read:', error)
    }
  }

  const markAllAsRead = async () => {
    try {
      const response = await fetch(`${NOTIFICATIONS_API_URL}/read-all`, {
        method: 'POST'
      })
      if (response.ok) {
        setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
        setUnreadCount(0)
      }
    } catch (error) {
      console.error('Error marking all as read:', error)
    }
  }

  const deleteNotification = async (notificationId) => {
    try {
      const response = await fetch(`${NOTIFICATIONS_API_URL}/${notificationId}`, {
        method: 'DELETE'
      })
      if (response.ok) {
        setNotifications(prev => prev.filter(n => n.id !== notificationId))
        // Обновляем счетчик
        const updated = notifications.filter(n => n.id !== notificationId)
        const newUnreadCount = updated.filter(n => !n.isRead).length
        setUnreadCount(newUnreadCount)
      }
    } catch (error) {
      console.error('Error deleting notification:', error)
    }
  }

  useEffect(() => {
    // Запрашиваем разрешение на уведомления при загрузке
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(err => console.error('Notification permission error:', err))
    }

    // Загрузка задач и уведомлений
    loadTasks()
    loadNotifications()

    // Инициализация SignalR подключения
    let newConnection
    try {
      newConnection = new signalR.HubConnectionBuilder()
        .withUrl(HUB_URL)
        .withAutomaticReconnect()
        .build()

      newConnection.start()
        .then(() => {
          console.log('SignalR Connected')
          setIsConnected(true)
          setConnection(newConnection)
          connectionRef.current = newConnection
        })
        .catch(err => {
          console.error('SignalR Connection Error: ', err)
          setIsConnected(false)
        })

      newConnection.onreconnecting(() => {
        setIsConnected(false)
      })

      newConnection.onreconnected(() => {
        setIsConnected(true)
      })

      // Удаляем старые обработчики перед регистрацией новых (на случай переподключения)
      newConnection.off('TaskUpdated')
      newConnection.off('AlarmTriggered')
      newConnection.off('NotificationReceived')
      newConnection.off('NotificationUpdated')
      newConnection.off('NotificationCountUpdated')

      // Подписка на обновления задач
      newConnection.on('TaskUpdated', (task) => {
        try {
          if (!task || !task.id) {
            console.warn('Received invalid task update:', task)
            return
          }
          setTasks(prevTasks => {
            if (!Array.isArray(prevTasks)) {
              return [task]
            }
            const index = prevTasks.findIndex(t => t && t.id === task.id)
            if (index >= 0) {
              const updated = [...prevTasks]
              updated[index] = task
              // Обновляем детали задачи, если модальное окно открыто
              if (showDetailsModal && detailsTask && detailsTask.id === task.id) {
                setDetailsTask(task)
              }
              return updated
            } else {
              return [task, ...prevTasks]
            }
          })
        } catch (err) {
          console.error('Error updating task:', err)
          // Не ломаем приложение, просто логируем ошибку
        }
      })

      // Подписка на срабатывание будильника
      newConnection.on('AlarmTriggered', (alarmData) => {
        try {
          // Проверяем, не показывали ли мы уже это уведомление
          const notificationKey = `${alarmData.taskId}-${alarmData.triggeredAt}`
          if (shownNotificationsRef.current.has(notificationKey)) {
            return // Уже показывали это уведомление
          }
          shownNotificationsRef.current.add(notificationKey)
          
          // Очищаем старые записи (оставляем только последние 100)
          if (shownNotificationsRef.current.size > 100) {
            const firstKey = shownNotificationsRef.current.values().next().value
            shownNotificationsRef.current.delete(firstKey)
          }

          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(alarmData.taskName, {
              body: alarmData.message,
              icon: '/vite.svg',
              tag: alarmData.taskId, // Браузер сам фильтрует дубликаты с одинаковым tag
              requireInteraction: false
            })
          } else if ('Notification' in window && Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
              if (permission === 'granted') {
                new Notification(alarmData.taskName, {
                  body: alarmData.message,
                  icon: '/vite.svg',
                  tag: alarmData.taskId,
                  requireInteraction: false
                })
              }
            }).catch(err => console.error('Notification error:', err))
          }
          
          alert(`${alarmData.taskName}\n\n${alarmData.message}`)
        } catch (err) {
          console.error('Error handling alarm:', err)
        }
      })

      // Подписка на уведомления
      newConnection.on('NotificationReceived', (notification) => {
        try {
          setNotifications(prev => [notification, ...prev])
          setUnreadCount(prev => prev + 1)
          
          // Показываем браузерное уведомление
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(notification.title, {
              body: notification.message,
              icon: '/vite.svg',
              tag: notification.id,
              requireInteraction: false
            })
          }
        } catch (err) {
          console.error('Error handling notification:', err)
        }
      })

      newConnection.on('NotificationUpdated', (notification) => {
        try {
          setNotifications(prev => prev.map(n => 
            n.id === notification.id ? notification : n
          ))
        } catch (err) {
          console.error('Error updating notification:', err)
        }
      })

      newConnection.on('NotificationCountUpdated', (count) => {
        try {
          setUnreadCount(count || 0)
        } catch (err) {
          console.error('Error updating notification count:', err)
        }
      })
    } catch (err) {
      console.error('Error setting up SignalR:', err)
      setIsConnected(false)
    }

    return () => {
      if (connectionRef.current) {
        try {
          connectionRef.current.stop()
        } catch (err) {
          console.error('Error stopping connection:', err)
        }
      }
    }
  }, [])

  // Обновляем детали задачи при обновлении через SignalR
  useEffect(() => {
    if (showDetailsModal && detailsTask) {
      const updatedTask = tasks.find(t => t && t.id === detailsTask.id)
      if (updatedTask) {
        setDetailsTask(updatedTask)
      }
    }
  }, [tasks, showDetailsModal, detailsTask])


  const handleCreateTask = async (e) => {
    e.preventDefault()
    try {
      const params = {}
      
      if (newTask.type === 'alarm') {
        const hours = parseFloat(newTask.parameters.hours || '0')
        const minutes = parseFloat(newTask.parameters.minutes || '0')
        const totalMs = (hours * 60 * 60 + minutes * 60) * 1000
        const alarmTime = new Date(Date.now() + totalMs)
        params.alarmTime = alarmTime.toISOString()
        params.message = newTask.parameters.message || 'Время пришло!'
      } else if (newTask.type === 'scheduler') {
        const executablePath = (newTask.parameters.executablePath || '').trim()
        if (!executablePath) {
          alert('Укажите путь к исполняемому файлу')
          return
        }
        params.executablePath = executablePath
        params.arguments = newTask.parameters.arguments || ''
        params.workingDirectory = newTask.parameters.workingDirectory || ''
        params.scheduleMode = newTask.parameters.scheduleMode || 'interval'
        
        if (params.scheduleMode === 'interval') {
          params.intervalSeconds = newTask.parameters.intervalSeconds || '60'
          params.executionCount = newTask.parameters.executionCount || '10'
        } else {
          params.delayBeforeStart = newTask.parameters.delayBeforeStart || '0'
          params.runDuration = newTask.parameters.runDuration || '60'
        }
      } else if (newTask.type === 'process') {
        const executablePath = (newTask.parameters.executablePath || '').trim()
        if (!executablePath) {
          alert('Укажите путь к исполняемому файлу')
          return
        }
        params.executablePath = executablePath
        params.arguments = newTask.parameters.arguments || ''
        params.workingDirectory = newTask.parameters.workingDirectory || ''
      } else if (newTask.type === 'rabbitmq') {
        const queueName = (newTask.parameters.queueName || '').trim()
        const message = (newTask.parameters.message || '').trim()
        if (!queueName) {
          alert('Укажите имя очереди')
          return
        }
        if (!message) {
          alert('Укажите сообщение для отправки')
          return
        }
        params.queueName = queueName
        params.message = message
        
        // Параметры для повторной отправки
        const executionCount = parseInt(newTask.parameters.executionCount || '1', 10)
        const intervalSeconds = parseInt(newTask.parameters.intervalSeconds || '0', 10)
        
        if (executionCount > 1) {
          params.executionCount = executionCount.toString()
          if (intervalSeconds > 0) {
            params.intervalSeconds = intervalSeconds.toString()
          }
        }
      } else if (newTask.type === 'rabbitmq_consumer') {
        const queueName = (newTask.parameters.queueName || '').trim()
        if (!queueName) {
          alert('Укажите имя очереди для прослушивания')
          return
        }
        params.queueName = queueName
      }

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newTask.name,
          type: newTask.type,
          parameters: params
        })
      })

      if (response.ok) {
        // Не добавляем задачу вручную - SignalR обновит список автоматически
        // const task = await response.json() // Не нужен, так как SignalR пришлет обновление
        setNewTask({ name: '', type: 'alarm', parameters: {} })
        setShowCreateModal(false)
      } else {
        const errorText = await response.text()
        console.error('Failed to create task:', errorText)
        alert('Ошибка при создании задачи')
      }
    } catch (error) {
      console.error('Error creating task:', error)
      alert('Ошибка при создании задачи')
    }
  }

  const handleStopTask = async (taskId) => {
    try {
      const response = await fetch(`${API_URL}/${taskId}/stop`, {
        method: 'POST'
      })

      if (!response.ok) {
        alert('Не удалось остановить задачу')
      }
    } catch (error) {
      console.error('Error stopping task:', error)
      alert('Ошибка при остановке задачи')
    }
  }

  const handlePauseTask = async (taskId) => {
    try {
      const response = await fetch(`${API_URL}/${taskId}/pause`, {
        method: 'POST'
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Неизвестная ошибка' }))
        alert(errorData.error || 'Не удалось приостановить задачу')
      }
    } catch (error) {
      console.error('Error pausing task:', error)
      alert('Ошибка при приостановке задачи')
    }
  }

  const handleResumeTask = async (taskId) => {
    try {
      const response = await fetch(`${API_URL}/${taskId}/resume`, {
        method: 'POST'
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Неизвестная ошибка' }))
        alert(errorData.error || 'Не удалось возобновить задачу')
      }
    } catch (error) {
      console.error('Error resuming task:', error)
      alert('Ошибка при возобновлении задачи')
    }
  }

  const handleDeleteTask = async (taskId) => {
    if (!confirm('Вы уверены, что хотите удалить эту задачу?')) {
      return
    }

    try {
      const response = await fetch(`${API_URL}/${taskId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        // Удаляем задачу из списка
        setTasks(prevTasks => prevTasks.filter(t => t.id !== taskId))
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Неизвестная ошибка' }))
        alert(errorData.error || 'Не удалось удалить задачу')
      }
    } catch (error) {
      console.error('Error deleting task:', error)
      alert('Ошибка при удалении задачи')
    }
  }

  const getTaskTypeText = (type) => {
    const typeMap = {
      'alarm': 'Будильник',
      'reminder': 'Напоминание',
      'scheduler': 'Планировщик задач',
      'process': 'Запуск процесса',
      'rabbitmq': 'Отправить в RabbitMQ',
      'rabbitmq_consumer': 'Слушать очередь RabbitMQ'
    }
    return typeMap[type] || type
  }

  const getStatusText = (status) => {
    // Маппинг числовых значений enum на строки
    const statusMap = {
      // Числовые значения (enum)
      0: 'Ожидание',
      1: 'Выполняется',
      2: 'Приостановлена',
      3: 'Завершена',
      4: 'Ошибка',
      5: 'Отменена',
      // Строковые значения (на случай если backend вернет строку)
      '0': 'Ожидание',
      '1': 'Выполняется',
      '2': 'Приостановлена',
      '3': 'Завершена',
      '4': 'Ошибка',
      '5': 'Отменена',
      'Pending': 'Ожидание',
      'Running': 'Выполняется',
      'Paused': 'Приостановлена',
      'Completed': 'Завершена',
      'Failed': 'Ошибка',
      'Cancelled': 'Отменена'
    }
    
    // Преобразуем status в строку для поиска
    const statusKey = status !== null && status !== undefined ? String(status) : '0'
    return statusMap[statusKey] || statusKey
  }

  const getStatusClass = (status) => {
    // Маппинг числовых значений enum на строки для CSS классов
    const statusClassMap = {
      0: 'pending',
      1: 'running',
      2: 'paused',
      3: 'completed',
      4: 'failed',
      5: 'cancelled',
      '0': 'pending',
      '1': 'running',
      '2': 'paused',
      '3': 'completed',
      '4': 'failed',
      '5': 'cancelled',
      'Pending': 'pending',
      'Running': 'running',
      'Paused': 'paused',
      'Completed': 'completed',
      'Failed': 'failed',
      'Cancelled': 'cancelled'
    }
    
    const statusKey = status !== null && status !== undefined ? String(status) : '0'
    const statusClass = statusClassMap[statusKey] || 'pending'
    return `status-${statusClass}`
  }

  const formatDate = (dateString) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    return date.toLocaleString('ru-RU', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  const formatTime = (dateString) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const filteredTasks = (() => {
    try {
      if (!Array.isArray(tasks)) {
        return []
      }
      return tasks.filter(task => {
        if (!task) return false
        try {
          const query = (searchQuery || '').toLowerCase()
          const statusText = getStatusText(task.status || 'Pending')
          return (
            (task.name && String(task.name).toLowerCase().includes(query)) ||
            (task.type && String(task.type).toLowerCase().includes(query)) ||
            (statusText && String(statusText).toLowerCase().includes(query))
          )
        } catch (err) {
          console.error('Error filtering task:', err, task)
          return false
        }
      })
    } catch (err) {
      console.error('Error in filteredTasks:', err)
      return []
    }
  })()

  const formatNotificationDate = (dateString) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'только что'
    if (diffMins < 60) return `${diffMins} мин. назад`
    if (diffHours < 24) return `${diffHours} ч. назад`
    if (diffDays < 7) return `${diffDays} дн. назад`
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="app">
      {/* Заголовок окна */}
      <div className="window-header">
        <div className="window-title">Диспетчер задач</div>
      </div>

      {/* Табы */}
      <div className="tabs-container">
        <button 
          className={`tab-button ${activeTab === 'tasks' ? 'active' : ''}`}
          onClick={() => setActiveTab('tasks')}
        >
          Задачи
        </button>
        <button 
          className={`tab-button ${activeTab === 'notifications' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('notifications')
            loadNotifications()
          }}
        >
          Уведомления
          {unreadCount > 0 && (
            <span className="unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
          )}
        </button>
      </div>

      {/* Панель инструментов */}
      {activeTab === 'tasks' && (
      <div className="toolbar">
        <div className="search-box">
          <input
            type="text"
            placeholder="Введите имя, тип или состояние для поиска"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <span className="search-icon"></span>
        </div>
        <button 
          className="toolbar-button" 
          onClick={() => setShowCreateModal(true)}
        >
          Запустить новую задачу
        </button>
        <button 
          className="toolbar-button danger" 
          disabled={!selectedTaskId}
          onClick={() => selectedTaskId && handleStopTask(selectedTaskId)}
        >
          Завершить задачу
        </button>
        <div className="connection-indicator">
          <span className={`connection-dot ${isConnected ? 'connected' : ''}`}></span>
          <span>{isConnected ? 'Подключено' : 'Отключено'}</span>
        </div>
      </div>
      )}

      {activeTab === 'notifications' && (
      <div className="toolbar">
        <div className="search-box" style={{ flex: 1 }}>
          <input
            type="text"
            placeholder="Поиск по очереди, сообщению или источнику..."
            value={notificationSearchQuery}
            onChange={(e) => setNotificationSearchQuery(e.target.value)}
          />
        </div>
        {unreadCount > 0 && (
          <button 
            className="toolbar-button" 
            onClick={markAllAsRead}
          >
            Отметить все как прочитанные
          </button>
        )}
      </div>
      )}

      {/* Контент вкладок */}
      {activeTab === 'tasks' && (
      <div className="table-container">
        {loading ? (
          <div className="empty-state">
            <div className="empty-state-text">Загрузка...</div>
          </div>
        ) : error ? (
          <div className="empty-state">
            <div className="empty-state-text" style={{ color: '#d13438' }}>{error}</div>
            <button 
              className="toolbar-button" 
              onClick={loadTasks}
              style={{ marginTop: '16px' }}
            >
              Повторить попытку
            </button>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"></div>
            <div className="empty-state-text">
              {searchQuery ? 'Задачи не найдены' : 'Нет задач'}
            </div>
          </div>
        ) : (
          <table className="tasks-table">
            <thead>
              <tr>
                <th style={{ width: '30%' }}>Имя</th>
                <th style={{ width: '12%' }}>Тип</th>
                <th style={{ width: '12%' }}>Состояние</th>
                <th style={{ width: '18%' }}>Прогресс</th>
                <th style={{ width: '18%' }}>Создана</th>
                <th style={{ width: '10%' }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map(task => {
                if (!task || !task.id) return null
                return (
                  <tr 
                    key={task.id}
                    className={selectedTaskId === task.id ? 'selected' : ''}
                    onClick={() => {
                      setSelectedTaskId(task.id)
                      setDetailsTask(task)
                      setShowDetailsModal(true)
                    }}
                  >
                    <td>
                      <div style={{ fontWeight: 500 }}>{task.name || '-'}</div>
                      {task.type === 'process' && (task.status === 'Running' || task.status === 1) && (task.cpuUsage !== undefined || task.memoryUsage !== undefined || task.processId) && (
                        <div style={{ 
                          fontSize: '11px', 
                          color: '#4ec9b0', 
                          marginTop: '4px',
                          display: 'flex',
                          gap: '12px',
                          flexWrap: 'wrap'
                        }}>
                          {task.processId && (
                            <span>PID: {task.processId}</span>
                          )}
                          {task.cpuUsage !== undefined && task.cpuUsage !== null && (
                            <span>CPU: {Number(task.cpuUsage).toFixed(1)}%</span>
                          )}
                          {task.memoryUsage !== undefined && task.memoryUsage !== null && (
                            <span>Память: {(Number(task.memoryUsage) / 1024 / 1024).toFixed(1)} МБ</span>
                          )}
                        </div>
                      )}
                      {task.errorMessage && (
                        <div style={{ 
                          fontSize: '11px', 
                          color: task.errorMessage.includes('ПРАВА АДМИНИСТРАТОРА') || task.errorMessage.includes('администратора') ? '#ffa500' : '#d13438', 
                          marginTop: '4px',
                          padding: '4px 8px',
                          background: task.errorMessage.includes('ПРАВА АДМИНИСТРАТОРА') || task.errorMessage.includes('администратора') 
                            ? 'rgba(255, 165, 0, 0.15)' 
                            : 'rgba(209, 52, 56, 0.1)',
                          borderRadius: '3px',
                          border: `1px solid ${task.errorMessage.includes('ПРАВА АДМИНИСТРАТОРА') || task.errorMessage.includes('администратора') 
                            ? 'rgba(255, 165, 0, 0.4)' 
                            : 'rgba(209, 52, 56, 0.3)'}`,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word'
                        }}>
                          <strong>{task.errorMessage.includes('ПРАВА АДМИНИСТРАТОРА') || task.errorMessage.includes('администратора') ? '⚠️ Предупреждение:' : 'Ошибка:'}</strong> {task.errorMessage}
                        </div>
                      )}
                    </td>
                    <td>{getTaskTypeText(task.type) || '-'}</td>
                    <td>
                      <span className={`status-badge ${getStatusClass(task.status || 'Pending')}`}>
                        {getStatusText(task.status || 'Pending')}
                      </span>
                    </td>
                    <td>
                      {(task.status === 'Running' || task.status === 1 || task.status === 2) && task.maxValue ? (
                        <div className="progress-cell">
                          <div className="progress-bar">
                            <div 
                              className="progress-fill" 
                              style={{ 
                                width: task.maxValue 
                                  ? `${(task.progress / task.maxValue) * 100}%` 
                                  : `${task.progress || 0}%` 
                              }}
                            ></div>
                          </div>
                          <span className="progress-text">
                            {task.maxValue 
                              ? `${task.progress || 0}/${task.maxValue}` 
                              : `${task.progress || 0}%`}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: '#808080' }}>-</span>
                      )}
                    </td>
                    <td style={{ color: '#808080', fontSize: '12px' }}>
                      {formatTime(task.createdAt)}
                    </td>
                    <td>
                      {(() => {
                        const status = task.status
                        const statusStr = String(status)
                        const statusText = getStatusText(status)
                        const isRunning = status === 'Running' || 
                                         status === 1 || 
                                         status === '1' || 
                                         statusStr === '1' ||
                                         statusText === 'Выполняется'
                        
                        const isPaused = status === 'Paused' || 
                                        status === 2 || 
                                        status === '2' || 
                                        statusStr === '2' ||
                                        statusText === 'Приостановлена'
                        
                        const isCompleted = status === 'Completed' || 
                                           status === 3 || 
                                           status === '3' || 
                                           statusStr === '3' ||
                                           statusText === 'Завершена'
                        
                        const isFailed = status === 'Failed' || 
                                        status === 4 || 
                                        status === '4' || 
                                        statusStr === '4' ||
                                        statusText === 'Ошибка'
                        
                        const isCancelled = status === 'Cancelled' || 
                                          status === 5 || 
                                          status === '5' || 
                                          statusStr === '5' ||
                                          statusText === 'Отменена'
                        
                        // Можно удалять завершенные, с ошибками и отмененные задачи
                        const canDelete = isCompleted || isFailed || isCancelled
                        
                        if (isRunning) {
                          return (
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <button
                                className="action-button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handlePauseTask(task.id)
                                }}
                              >
                                Пауза
                              </button>
                              <button
                                className="action-button danger"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleStopTask(task.id)
                                }}
                              >
                                Завершить
                              </button>
                            </div>
                          )
                        }
                        
                        if (isPaused) {
                          return (
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <button
                                className="action-button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleResumeTask(task.id)
                                }}
                              >
                                Возобновить
                              </button>
                              <button
                                className="action-button danger"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleStopTask(task.id)
                                }}
                              >
                                Завершить
                              </button>
                            </div>
                          )
                        }
                        
                        if (canDelete) {
                          return (
                            <button
                              className="action-button"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteTask(task.id)
                              }}
                            >
                              Убрать
                            </button>
                          )
                        }
                        
                        return null
                      })()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      )}

      {activeTab === 'notifications' && (
      <div className="table-container">
        {(() => {
          // Фильтруем уведомления по поисковому запросу
          const filteredNotifications = notificationSearchQuery.trim() === ''
            ? notifications
            : notifications.filter(notification => {
                const searchLower = notificationSearchQuery.toLowerCase()
                const title = (notification.title || '').toLowerCase()
                const message = (notification.message || '').toLowerCase()
                const source = (notification.source || '').toLowerCase()
                
                return title.includes(searchLower) || 
                       message.includes(searchLower) || 
                       source.includes(searchLower)
              })

          if (filteredNotifications.length === 0) {
            return (
              <div className="empty-state">
                <div className="empty-state-icon"></div>
                <div className="empty-state-text">
                  {notificationSearchQuery.trim() === '' 
                    ? 'Нет уведомлений' 
                    : `Не найдено уведомлений по запросу "${notificationSearchQuery}"`}
                </div>
              </div>
            )
          }

          return (
            <div className="notifications-list">
              {filteredNotifications.map(notification => (
                <div 
                  key={notification.id} 
                  className={`notification-item ${!notification.isRead ? 'unread' : ''}`}
                  onClick={() => {
                    if (!notification.isRead) {
                      markAsRead(notification.id)
                    }
                  }}
                >
                  <div className="notification-header">
                    <div className="notification-title-row">
                      <h3 className="notification-title">{notification.title}</h3>
                      {!notification.isRead && <span className="unread-dot"></span>}
                    </div>
                    <div className="notification-actions">
                      <button
                        className="notification-action-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteNotification(notification.id)
                        }}
                        title="Удалить"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="notification-message">
                    {(() => {
                      // Пытаемся определить, является ли сообщение JSON
                      try {
                        const parsed = JSON.parse(notification.message)
                        const isExpanded = expandedNotifications.has(notification.id)
                        return (
                          <div className="notification-json-container">
                            <button
                              className="notification-expand-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                const newExpanded = new Set(expandedNotifications)
                                if (isExpanded) {
                                  newExpanded.delete(notification.id)
                                } else {
                                  newExpanded.add(notification.id)
                                }
                                setExpandedNotifications(newExpanded)
                              }}
                            >
                              <span className="notification-expand-icon">{isExpanded ? '▼' : '▶'}</span>
                              <span>Данные</span>
                            </button>
                            {isExpanded && (
                              <div className="notification-json">
                                <pre className="notification-json-content">
                                  {JSON.stringify(parsed, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )
                      } catch {
                        // Если не JSON, показываем как обычный текст
                        return <div className="notification-text">{notification.message}</div>
                      }
                    })()}
                  </div>
                  <div className="notification-footer">
                    <div className="notification-source-badge">
                      <span className="notification-source">{notification.source || 'System'}</span>
                    </div>
                    <span className="notification-date">{formatNotificationDate(notification.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        })()}
      </div>
      )}

      {/* Модальное окно создания задачи */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Запустить новую задачу</div>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <form onSubmit={handleCreateTask}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Название задачи:</label>
                  <input
                    type="text"
                    value={newTask.name}
                    onChange={(e) => setNewTask({ ...newTask, name: e.target.value })}
                    required
                    placeholder="Введите название задачи"
                  />
                </div>

                <div className="form-group">
                  <label>Тип задачи:</label>
                  <select
                    value={newTask.type}
                    onChange={(e) => setNewTask({ ...newTask, type: e.target.value, parameters: {} })}
                  >
                    <option value="alarm">Будильник</option>
                    <option value="scheduler">Планировщик задач</option>
                    <option value="process">Запуск процесса</option>
                    <option value="rabbitmq">Отправить в RabbitMQ</option>
                    <option value="rabbitmq_consumer">Слушать очередь RabbitMQ</option>
                  </select>
                </div>


                {newTask.type === 'alarm' && (
                  <div className="form-group">
                    <div className="form-row">
                      <div>
                        <label>Часы:</label>
                        <input
                          type="number"
                          value={newTask.parameters.hours ?? ''}
                          onChange={(e) => setNewTask({
                            ...newTask,
                            parameters: { ...newTask.parameters, hours: e.target.value }
                          })}
                          min="0"
                          step="1"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label>Минуты:</label>
                        <input
                          type="number"
                          value={newTask.parameters.minutes ?? ''}
                          onChange={(e) => setNewTask({
                            ...newTask,
                            parameters: { ...newTask.parameters, minutes: e.target.value }
                          })}
                          min="0"
                          max="59"
                          step="1"
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <small>Будильник сработает через указанное время от текущего момента</small>
                    <label style={{ marginTop: '12px' }}>Сообщение:</label>
                    <input
                      type="text"
                      value={newTask.parameters.message ?? ''}
                      onChange={(e) => setNewTask({
                        ...newTask,
                        parameters: { ...newTask.parameters, message: e.target.value }
                      })}
                      placeholder="Время пришло!"
                    />
                  </div>
                )}

                {newTask.type === 'scheduler' && (
                  <div className="form-group">
                    <label>Режим работы:</label>
                    <select
                      value={newTask.parameters.scheduleMode || 'interval'}
                      onChange={(e) => setNewTask({
                        ...newTask,
                        parameters: { ...newTask.parameters, scheduleMode: e.target.value }
                      })}
                    >
                      <option value="interval">Повторяющийся запуск (через интервалы)</option>
                      <option value="delayed">Запуск с задержкой и авто-закрытие</option>
                    </select>
                    <small>Выберите режим работы планировщика</small>
                    
                    <label style={{ marginTop: '12px' }}>Путь к исполняемому файлу:</label>
                    <input
                      type="text"
                      value={newTask.parameters.executablePath ?? ''}
                      onChange={(e) => setNewTask({
                        ...newTask,
                        parameters: { ...newTask.parameters, executablePath: e.target.value }
                      })}
                      placeholder="C:\\Windows\\System32\\notepad.exe"
                    />
                    <small>Полный путь к .exe файлу или имя программы из PATH</small>
                    
                    <label style={{ marginTop: '12px' }}>Аргументы (необязательно):</label>
                    <input
                      type="text"
                      value={newTask.parameters.arguments ?? ''}
                      onChange={(e) => setNewTask({
                        ...newTask,
                        parameters: { ...newTask.parameters, arguments: e.target.value }
                      })}
                      placeholder="C:\\path\\to\\file.txt"
                    />
                    <small>Аргументы командной строки для передачи программе</small>
                    
                    <label style={{ marginTop: '12px' }}>Рабочая директория (необязательно):</label>
                    <input
                      type="text"
                      value={newTask.parameters.workingDirectory ?? ''}
                      onChange={(e) => setNewTask({
                        ...newTask,
                        parameters: { ...newTask.parameters, workingDirectory: e.target.value }
                      })}
                      placeholder="C:\\WorkingDirectory"
                    />
                    <small>Директория, в которой будет запущена программа</small>
                    
                    {newTask.parameters.scheduleMode === 'interval' ? (
                      <>
                        <div className="form-row" style={{ marginTop: '12px' }}>
                          <div>
                            <label>Интервал (секунды):</label>
                            <input
                              type="number"
                              value={newTask.parameters.intervalSeconds ?? ''}
                              onChange={(e) => setNewTask({
                                ...newTask,
                                parameters: { ...newTask.parameters, intervalSeconds: e.target.value }
                              })}
                              min="1"
                              step="1"
                              placeholder="60"
                            />
                          </div>
                          <div>
                            <label>Количество выполнений:</label>
                            <input
                              type="number"
                              value={newTask.parameters.executionCount ?? ''}
                              onChange={(e) => setNewTask({
                                ...newTask,
                                parameters: { ...newTask.parameters, executionCount: e.target.value }
                              })}
                              min="1"
                              step="1"
                              placeholder="10"
                            />
                          </div>
                        </div>
                        <small style={{ marginTop: '8px', display: 'block' }}>
                          Программа будет запускаться через указанные интервалы указанное количество раз
                        </small>
                      </>
                    ) : (
                      <>
                        <div className="form-row" style={{ marginTop: '12px' }}>
                          <div>
                            <label>Задержка перед запуском (секунды):</label>
                            <input
                              type="number"
                              value={newTask.parameters.delayBeforeStart ?? ''}
                              onChange={(e) => setNewTask({
                                ...newTask,
                                parameters: { ...newTask.parameters, delayBeforeStart: e.target.value }
                              })}
                              min="0"
                              step="1"
                              placeholder="0"
                            />
                          </div>
                          <div>
                            <label>Время работы программы (секунды):</label>
                            <input
                              type="number"
                              value={newTask.parameters.runDuration ?? ''}
                              onChange={(e) => setNewTask({
                                ...newTask,
                                parameters: { ...newTask.parameters, runDuration: e.target.value }
                              })}
                              min="1"
                              step="1"
                              placeholder="60"
                            />
                          </div>
                        </div>
                        <small style={{ marginTop: '8px', display: 'block' }}>
                          Программа запустится через указанную задержку и автоматически закроется через указанное время
                        </small>
                      </>
                    )}
                  </div>
                )}

                {newTask.type === 'process' && (
                  <div className="form-group">
                    <label>Путь к исполняемому файлу:</label>
                    <input
                      type="text"
                      value={newTask.parameters.executablePath ?? ''}
                      onChange={(e) => setNewTask({
                        ...newTask,
                        parameters: { ...newTask.parameters, executablePath: e.target.value }
                      })}
                      placeholder="C:\\Windows\\System32\\notepad.exe"
                    />
                    <small>Полный путь к .exe файлу или имя программы из PATH</small>
                    
                    <label style={{ marginTop: '12px' }}>Аргументы (необязательно):</label>
                    <input
                      type="text"
                      value={newTask.parameters.arguments ?? ''}
                      onChange={(e) => setNewTask({
                        ...newTask,
                        parameters: { ...newTask.parameters, arguments: e.target.value }
                      })}
                      placeholder="C:\\path\\to\\file.txt"
                    />
                    <small>Аргументы командной строки для передачи процессу</small>
                    
                    <label style={{ marginTop: '12px' }}>Рабочая директория (необязательно):</label>
                    <input
                      type="text"
                      value={newTask.parameters.workingDirectory ?? ''}
                      onChange={(e) => setNewTask({
                        ...newTask,
                        parameters: { ...newTask.parameters, workingDirectory: e.target.value }
                      })}
                      placeholder="C:\\WorkingDirectory"
                    />
                    <small>Директория, в которой будет запущен процесс</small>
                  </div>
                )}

                {newTask.type === 'rabbitmq' && (
                  <div className="form-group">
                    <label>Имя очереди:</label>
                    <input
                      type="text"
                      value={newTask.parameters.queueName ?? ''}
                      onChange={(e) => setNewTask({
                        ...newTask,
                        parameters: { ...newTask.parameters, queueName: e.target.value }
                      })}
                      placeholder="test_queue"
                      required
                    />
                    <small>Имя очереди RabbitMQ, в которую будет отправлено сообщение</small>
                    
                    <label style={{ marginTop: '12px' }}>Сообщение:</label>
                    <textarea
                      value={newTask.parameters.message ?? ''}
                      onChange={(e) => setNewTask({
                        ...newTask,
                        parameters: { ...newTask.parameters, message: e.target.value }
                      })}
                      placeholder="Введите сообщение для отправки в очередь"
                      rows="4"
                      required
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        background: '#1e1e1e',
                        border: '1px solid #3d3d3d',
                        borderRadius: '4px',
                        color: '#ffffff',
                        fontSize: '13px',
                        fontFamily: 'Segoe UI, sans-serif',
                        resize: 'vertical',
                        outline: 'none'
                      }}
                    />
                    <small>Текст сообщения, которое будет отправлено в очередь RabbitMQ</small>
                    
                    <div className="form-row" style={{ marginTop: '12px' }}>
                      <div>
                        <label>Количество отправок:</label>
                        <input
                          type="number"
                          value={newTask.parameters.executionCount ?? '1'}
                          onChange={(e) => setNewTask({
                            ...newTask,
                            parameters: { ...newTask.parameters, executionCount: e.target.value }
                          })}
                          min="1"
                          step="1"
                          placeholder="1"
                        />
                        <small>Сколько раз отправить сообщение</small>
                      </div>
                      <div>
                        <label>Интервал (секунды):</label>
                        <input
                          type="number"
                          value={newTask.parameters.intervalSeconds ?? '0'}
                          onChange={(e) => setNewTask({
                            ...newTask,
                            parameters: { ...newTask.parameters, intervalSeconds: e.target.value }
                          })}
                          min="0"
                          step="1"
                          placeholder="0"
                        />
                        <small>Пауза между отправками (0 = без паузы)</small>
                      </div>
                    </div>
                    <small style={{ marginTop: '8px', display: 'block' }}>
                      {parseInt(newTask.parameters.executionCount || '1', 10) > 1 
                        ? `Сообщение будет отправлено ${newTask.parameters.executionCount || '1'} раз${parseInt(newTask.parameters.intervalSeconds || '0', 10) > 0 ? ` с интервалом ${newTask.parameters.intervalSeconds || '0'} секунд` : ' без паузы'}`
                        : 'Сообщение будет отправлено один раз'}
                    </small>
                  </div>
                )}

                {newTask.type === 'rabbitmq_consumer' && (
                  <div className="form-group">
                    <label>Имя очереди для прослушивания:</label>
                    <input
                      type="text"
                      value={newTask.parameters.queueName ?? ''}
                      onChange={(e) => setNewTask({
                        ...newTask,
                        parameters: { ...newTask.parameters, queueName: e.target.value }
                      })}
                      placeholder="test_queue"
                      required
                    />
                    <small>Имя очереди RabbitMQ, которую будет слушать эта задача. При получении сообщений будут создаваться уведомления.</small>
                  </div>
                )}

              </div>
              <div className="modal-footer">
                <button type="button" className="toolbar-button" onClick={() => setShowCreateModal(false)}>
                  Отмена
                </button>
                <button type="submit" className="toolbar-button">
                  Создать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Модальное окно с деталями задачи */}
      {showDetailsModal && detailsTask && (
        <div className="modal-overlay" onClick={() => setShowDetailsModal(false)}>
          <div className="modal-content" style={{ maxWidth: '800px', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Детали задачи: {detailsTask.name}</h2>
              <button className="close-button" onClick={() => setShowDetailsModal(false)}>×</button>
            </div>

            <div className="modal-body" style={{ padding: '20px' }}>
              {/* Общая информация */}
              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ marginBottom: '12px', color: '#4ec9b0' }}>Общая информация</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '14px' }}>
                  <div>
                    <strong>Тип:</strong> {getTaskTypeText(detailsTask.type)}
                  </div>
                  <div>
                    <strong>Статус:</strong> <span className={`status-badge ${getStatusClass(detailsTask.status || 'Pending')}`}>
                      {getStatusText(detailsTask.status || 'Pending')}
                    </span>
                  </div>
                  <div>
                    <strong>Создана:</strong> {formatTime(detailsTask.createdAt)}
                  </div>
                  {detailsTask.startedAt && (
                    <div>
                      <strong>Запущена:</strong> {formatTime(detailsTask.startedAt)}
                    </div>
                  )}
                  {detailsTask.completedAt && (
                    <div>
                      <strong>Завершена:</strong> {formatTime(detailsTask.completedAt)}
                    </div>
                  )}
                  {detailsTask.processId && (
                    <div>
                      <strong>PID:</strong> {detailsTask.processId}
                    </div>
                  )}
                </div>
              </div>

              {/* Для процессов - детальная информация */}
              {detailsTask.type === 'process' && (
                <>
                  <div style={{ marginBottom: '24px' }}>
                    <h3 style={{ marginBottom: '12px', color: '#4ec9b0' }}>Метрики процесса</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '14px' }}>
                      {detailsTask.cpuUsage !== undefined && detailsTask.cpuUsage !== null && (
                        <div>
                          <strong>CPU:</strong> {Number(detailsTask.cpuUsage).toFixed(2)}%
                        </div>
                      )}
                      {detailsTask.memoryUsage !== undefined && detailsTask.memoryUsage !== null && (
                        <div>
                          <strong>Память:</strong> {(Number(detailsTask.memoryUsage) / 1024 / 1024).toFixed(2)} МБ
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ marginBottom: '24px' }}>
                    <h3 style={{ marginBottom: '12px', color: '#4ec9b0' }}>Информация о процессе</h3>
                    <div style={{ fontSize: '14px', background: '#1e1e1e', padding: '12px', borderRadius: '4px' }}>
                      <div style={{ marginBottom: '8px' }}>
                        <strong>Статус процесса:</strong><br />
                        <span style={{ color: '#4ec9b0' }}>
                          {detailsTask.status === 'Running' || detailsTask.status === 1 
                            ? 'Запущен и работает' 
                            : detailsTask.status === 'Completed' || detailsTask.status === 2
                            ? 'Завершен успешно'
                            : detailsTask.status === 'Failed' || detailsTask.status === 3
                            ? 'Завершен с ошибкой'
                            : 'Не запущен'}
                        </span>
                      </div>
                      {detailsTask.processId && (
                        <div style={{ marginTop: '8px' }}>
                          <strong>Идентификатор процесса (PID):</strong><br />
                          <code style={{ color: '#4ec9b0' }}>{detailsTask.processId}</code>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Ошибка */}
              {detailsTask.errorMessage && (
                <div style={{ marginBottom: '24px' }}>
                  <h3 style={{ marginBottom: '12px', color: '#d13438' }}>Ошибка</h3>
                  <div style={{ 
                    background: 'rgba(209, 52, 56, 0.1)', 
                    padding: '12px', 
                    borderRadius: '4px',
                    border: '1px solid rgba(209, 52, 56, 0.3)',
                    fontSize: '14px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: '#d13438'
                  }}>
                    {detailsTask.errorMessage}
                  </div>
                </div>
              )}

              {/* Прогресс */}
              {detailsTask.maxValue && (
                <div style={{ marginBottom: '24px' }}>
                  <h3 style={{ marginBottom: '12px', color: '#4ec9b0' }}>Прогресс</h3>
                  <div style={{ fontSize: '14px' }}>
                    {detailsTask.maxValue 
                      ? `${detailsTask.progress || 0} / ${detailsTask.maxValue}`
                      : `${detailsTask.progress || 0}%`}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button type="button" className="toolbar-button" onClick={() => setShowDetailsModal(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
