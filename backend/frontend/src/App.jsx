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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newTask, setNewTask] = useState({
    name: '',
    type: 'fileprocessor',
    parameters: {}
  })

  const connectionRef = useRef(null)

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
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(alarmData.taskName, {
              body: alarmData.message,
              icon: '/vite.svg',
              tag: alarmData.taskId
            })
          } else if ('Notification' in window && Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
              if (permission === 'granted') {
                new Notification(alarmData.taskName, {
                  body: alarmData.message,
                  icon: '/vite.svg',
                  tag: alarmData.taskId
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


  const handleCreateTask = async (e) => {
    e.preventDefault()
    try {
      const params = {}
      
      if (newTask.type === 'fileprocessor') {
        params.fileCount = newTask.parameters.fileCount || '10'
        params.delayMs = newTask.parameters.delayMs || '1000'
      } else if (newTask.type === 'datagenerator') {
        params.itemCount = newTask.parameters.itemCount || '50'
        params.delayMs = newTask.parameters.delayMs || '300'
      } else if (newTask.type === 'alarm') {
        const hours = parseFloat(newTask.parameters.hours || '0')
        const minutes = parseFloat(newTask.parameters.minutes || '0')
        const totalMs = (hours * 60 * 60 + minutes * 60) * 1000
        const alarmTime = new Date(Date.now() + totalMs)
        params.alarmTime = alarmTime.toISOString()
        params.message = newTask.parameters.message || 'Время пришло!'
      } else if (newTask.type === 'scheduler') {
        params.intervalSeconds = newTask.parameters.intervalSeconds || '60'
        params.executionCount = newTask.parameters.executionCount || '10'
        params.command = newTask.parameters.command || 'echo "Task executed"'
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
        setNewTask({ name: '', type: 'fileprocessor', parameters: {} })
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
      'fileprocessor': 'Обработка файлов',
      'datagenerator': 'Генератор данных',
      'alarm': 'Будильник',
      'reminder': 'Напоминание',
      'scheduler': 'Планировщик задач'
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
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <td>
                      <div style={{ fontWeight: 500 }}>{task.name || '-'}</div>
                      {task.message && (
                        <div style={{ fontSize: '11px', color: '#808080', marginTop: '2px' }}>
                          {task.message}
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
                    <option value="fileprocessor">Обработка файлов</option>
                    <option value="datagenerator">Генератор данных</option>
                    <option value="alarm">Будильник</option>
                    <option value="scheduler">Планировщик задач</option>
                  </select>
                </div>


                {newTask.type === 'fileprocessor' && (
                  <div className="form-group">
                    <div className="form-row">
                      <div>
                        <label>Количество файлов:</label>
                        <input
                          type="number"
                          value={newTask.parameters.fileCount ?? ''}
                          onChange={(e) => setNewTask({
                            ...newTask,
                            parameters: { ...newTask.parameters, fileCount: e.target.value }
                          })}
                          min="1"
                          placeholder="10"
                        />
                      </div>
                      <div>
                        <label>Задержка (мс):</label>
                        <input
                          type="number"
                          value={newTask.parameters.delayMs ?? ''}
                          onChange={(e) => setNewTask({
                            ...newTask,
                            parameters: { ...newTask.parameters, delayMs: e.target.value }
                          })}
                          min="100"
                          placeholder="1000"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {newTask.type === 'datagenerator' && (
                  <div className="form-group">
                    <div className="form-row">
                      <div>
                        <label>Количество элементов:</label>
                        <input
                          type="number"
                          value={newTask.parameters.itemCount ?? ''}
                          onChange={(e) => setNewTask({
                            ...newTask,
                            parameters: { ...newTask.parameters, itemCount: e.target.value }
                          })}
                          min="1"
                          placeholder="50"
                        />
                      </div>
                      <div>
                        <label>Задержка (мс):</label>
                        <input
                          type="number"
                          value={newTask.parameters.delayMs ?? ''}
                          onChange={(e) => setNewTask({
                            ...newTask,
                            parameters: { ...newTask.parameters, delayMs: e.target.value }
                          })}
                          min="100"
                          placeholder="300"
                        />
                      </div>
                    </div>
                  </div>
                )}

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
                      value={newTask.parameters.message || 'Время пришло!'}
                      onChange={(e) => setNewTask({
                        ...newTask,
                        parameters: { ...newTask.parameters, message: e.target.value }
                      })}
                      placeholder="Введите сообщение для будильника"
                    />
                  </div>
                )}

                {newTask.type === 'scheduler' && (
                  <div className="form-group">
                    <div className="form-row">
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
                    <label style={{ marginTop: '12px' }}>Команда (имитация):</label>
                    <input
                      type="text"
                      value={newTask.parameters.command || 'echo "Task executed"'}
                      onChange={(e) => setNewTask({
                        ...newTask,
                        parameters: { ...newTask.parameters, command: e.target.value }
                      })}
                      placeholder="Введите команду для выполнения"
                    />
                    <small>Планировщик будет выполнять команду через указанные интервалы</small>
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
    </div>
  )
}

export default App
