import { useState, useEffect, useRef } from 'react'
import * as signalR from '@microsoft/signalr'
import './App.css'

const API_URL = '/api/tasks'
const HUB_URL = '/taskhub'

function App() {
  const [tasks, setTasks] = useState([])
  const [connection, setConnection] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
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

  useEffect(() => {
    // Запрашиваем разрешение на уведомления при загрузке
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(err => console.error('Notification permission error:', err))
    }

    // Загрузка задач сначала
    loadTasks()

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
      'process': 'Запуск процесса'
    }
    return typeMap[type] || type
  }

  const getStatusText = (status) => {
    // Маппинг числовых значений enum на строки
    const statusMap = {
      // Числовые значения (enum)
      0: 'Ожидание',
      1: 'Выполняется',
      2: 'Завершена',
      3: 'Ошибка',
      4: 'Отменена',
      // Строковые значения (на случай если backend вернет строку)
      '0': 'Ожидание',
      '1': 'Выполняется',
      '2': 'Завершена',
      '3': 'Ошибка',
      '4': 'Отменена',
      'Pending': 'Ожидание',
      'Running': 'Выполняется',
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
      2: 'completed',
      3: 'failed',
      4: 'cancelled',
      '0': 'pending',
      '1': 'running',
      '2': 'completed',
      '3': 'failed',
      '4': 'cancelled',
      'Pending': 'pending',
      'Running': 'running',
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

  return (
    <div className="app">
      {/* Заголовок окна */}
      <div className="window-header">
        <div className="window-title">Диспетчер задач</div>
      </div>

      {/* Панель инструментов */}
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

      {/* Таблица задач */}
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
                        
                        const isCompleted = status === 'Completed' || 
                                           status === 2 || 
                                           status === '2' || 
                                           statusStr === '2' ||
                                           statusText === 'Завершена'
                        
                        const isFailed = status === 'Failed' || 
                                        status === 3 || 
                                        status === '3' || 
                                        statusStr === '3' ||
                                        statusText === 'Ошибка'
                        
                        const isCancelled = status === 'Cancelled' || 
                                          status === 4 || 
                                          status === '4' || 
                                          statusStr === '4' ||
                                          statusText === 'Отменена'
                        
                        // Можно удалять завершенные, с ошибками и отмененные задачи
                        const canDelete = isCompleted || isFailed || isCancelled
                        
                        if (isRunning) {
                          return (
                            <button
                              className="action-button danger"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleStopTask(task.id)
                              }}
                            >
                              Завершить
                            </button>
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
