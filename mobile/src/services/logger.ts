// Comprehensive Logging Service for Trinity App
// Logs all user actions and backend interactions for debugging

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  action: string;
  data?: any;
  error?: any;
}

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 1000; // Keep last 1000 logs

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private addLog(level: LogLevel, category: string, action: string, data?: any, error?: any) {
    const logEntry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level,
      category,
      action,
      data,
      error,
    };

    // Add to internal storage
    this.logs.push(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift(); // Remove oldest log
    }

    // Console output with colors and formatting
    const prefix = `[${logEntry.timestamp}] [${level}] [${category}]`;
    const message = `${action}`;
    
    switch (level) {
      case LogLevel.DEBUG:
        console.log(`🔍 ${prefix} ${message}`, data || '');
        break;
      case LogLevel.INFO:
        console.info(`ℹ️ ${prefix} ${message}`, data || '');
        break;
      case LogLevel.WARN:
        console.warn(`⚠️ ${prefix} ${message}`, data || '');
        break;
      case LogLevel.ERROR:
        console.error(`❌ ${prefix} ${message}`, error || data || '');
        break;
    }
  }

  // User Actions
  userAction(action: string, data?: any) {
    this.addLog(LogLevel.INFO, 'USER', action, data);
  }

  // Navigation
  navigation(action: string, data?: any) {
    this.addLog(LogLevel.INFO, 'NAVIGATION', action, data);
  }

  // Backend API calls
  apiRequest(action: string, data?: any) {
    this.addLog(LogLevel.INFO, 'API_REQUEST', action, data);
  }

  apiResponse(action: string, data?: any) {
    this.addLog(LogLevel.INFO, 'API_RESPONSE', action, data);
  }

  apiError(action: string, error: any, data?: any) {
    this.addLog(LogLevel.ERROR, 'API_ERROR', action, data, error);
  }

  // Authentication
  auth(action: string, data?: any) {
    this.addLog(LogLevel.INFO, 'AUTH', action, data);
  }

  authError(action: string, error: any) {
    this.addLog(LogLevel.ERROR, 'AUTH_ERROR', action, undefined, error);
  }

  // Room operations
  room(action: string, data?: any) {
    this.addLog(LogLevel.INFO, 'ROOM', action, data);
  }

  roomError(action: string, error: any, data?: any) {
    this.addLog(LogLevel.ERROR, 'ROOM_ERROR', action, data, error);
  }

  // Voting operations
  vote(action: string, data?: any) {
    this.addLog(LogLevel.INFO, 'VOTE', action, data);
  }

  voteError(action: string, error: any, data?: any) {
    this.addLog(LogLevel.ERROR, 'VOTE_ERROR', action, data, error);
  }

  // UI interactions
  ui(action: string, data?: any) {
    this.addLog(LogLevel.DEBUG, 'UI', action, data);
  }

  // General debug
  debug(category: string, action: string, data?: any) {
    this.addLog(LogLevel.DEBUG, category, action, data);
  }

  // General info
  info(category: string, action: string, data?: any) {
    this.addLog(LogLevel.INFO, category, action, data);
  }

  // General warning
  warn(category: string, action: string, data?: any) {
    this.addLog(LogLevel.WARN, category, action, data);
  }

  // General error
  error(category: string, action: string, error: any, data?: any) {
    this.addLog(LogLevel.ERROR, category, action, data, error);
  }

  // Get all logs (for debugging)
  getAllLogs(): LogEntry[] {
    return [...this.logs];
  }

  // Get logs by category
  getLogsByCategory(category: string): LogEntry[] {
    return this.logs.filter(log => log.category === category);
  }

  // Get recent logs
  getRecentLogs(count: number = 50): LogEntry[] {
    return this.logs.slice(-count);
  }

  // Clear logs
  clearLogs() {
    this.logs = [];
    console.log('🧹 Logger: All logs cleared');
  }

  // Export logs as string (for sharing/debugging)
  exportLogs(): string {
    return this.logs.map(log => 
      `[${log.timestamp}] [${log.level}] [${log.category}] ${log.action}` +
      (log.data ? ` | Data: ${JSON.stringify(log.data)}` : '') +
      (log.error ? ` | Error: ${JSON.stringify(log.error)}` : '')
    ).join('\n');
  }
}

// Export singleton instance
export const logger = new Logger();

// Initialize logging
logger.info('SYSTEM', 'Logger initialized', { 
  timestamp: new Date().toISOString(),
  platform: 'React Native',
  app: 'Trinity Movie Voting'
});