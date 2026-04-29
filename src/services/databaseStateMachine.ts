/**
 * State Machine for Database Connection Management
 * Provides formal state transitions and prevents invalid operations
 */

export enum DatabaseState {
  UNINITIALIZED = 'uninitialized',
  INITIALIZING = 'initializing',
  CONNECTED = 'connected',
  OFFLINE = 'offline',
  SYNCING = 'syncing',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
  DESTROYED = 'destroyed'
}

export type StateTransition = {
  from: DatabaseState;
  to: DatabaseState;
  timestamp: number;
  reason?: string;
};

export type StateChangeListener = (transition: StateTransition) => void;

/**
 * Database State Machine
 * Manages valid state transitions and enforces connection lifecycle
 */
export class DatabaseStateMachine {
  private currentState: DatabaseState = DatabaseState.UNINITIALIZED;
  private previousState: DatabaseState | null = null;
  private stateHistory: StateTransition[] = [];
  private listeners: Set<StateChangeListener> = new Set();
  
  // Define valid state transitions
  private readonly validTransitions: Map<DatabaseState, Set<DatabaseState>> = new Map<DatabaseState, Set<DatabaseState>>([
    [DatabaseState.UNINITIALIZED, new Set<DatabaseState>([
      DatabaseState.INITIALIZING
    ])],
    [DatabaseState.INITIALIZING, new Set<DatabaseState>([
      DatabaseState.CONNECTED,
      DatabaseState.OFFLINE,
      DatabaseState.ERROR
    ])],
    [DatabaseState.CONNECTED, new Set<DatabaseState>([
      DatabaseState.OFFLINE,
      DatabaseState.SYNCING,
      DatabaseState.RECONNECTING,
      DatabaseState.DESTROYED
    ])],
    [DatabaseState.OFFLINE, new Set<DatabaseState>([
      DatabaseState.RECONNECTING,
      DatabaseState.CONNECTED,
      DatabaseState.DESTROYED
    ])],
    [DatabaseState.SYNCING, new Set<DatabaseState>([
      DatabaseState.CONNECTED,
      DatabaseState.OFFLINE,
      DatabaseState.ERROR
    ])],
    [DatabaseState.RECONNECTING, new Set<DatabaseState>([
      DatabaseState.CONNECTED,
      DatabaseState.OFFLINE,
      DatabaseState.ERROR
    ])],
    [DatabaseState.ERROR, new Set<DatabaseState>([
      DatabaseState.RECONNECTING,
      DatabaseState.INITIALIZING,
      DatabaseState.DESTROYED
    ])],
    [DatabaseState.DESTROYED, new Set<DatabaseState>([
      DatabaseState.UNINITIALIZED // Can reinitialize after destroy
    ])]
  ]);

  constructor(initialState: DatabaseState = DatabaseState.UNINITIALIZED) {
    this.currentState = initialState;
  }

  /**
   * Get current state
   */
  getState(): DatabaseState {
    return this.currentState;
  }

  /**
   * Get previous state
   */
  getPreviousState(): DatabaseState | null {
    return this.previousState;
  }

  /**
   * Check if in a specific state
   */
  is(state: DatabaseState): boolean {
    return this.currentState === state;
  }

  /**
   * Check if in one of multiple states
   */
  isOneOf(...states: DatabaseState[]): boolean {
    return states.includes(this.currentState);
  }

  /**
   * Check if transition is valid
   */
  canTransitionTo(targetState: DatabaseState): boolean {
    const allowedStates = this.validTransitions.get(this.currentState);
    return allowedStates?.has(targetState) ?? false;
  }

  /**
   * Transition to a new state
   */
  transition(targetState: DatabaseState, reason?: string): boolean {
    // Check if transition is valid
    if (!this.canTransitionTo(targetState)) {
      console.warn(
        `Invalid state transition: ${this.currentState} -> ${targetState}`,
        reason ? `Reason: ${reason}` : ''
      );
      return false;
    }

    // Perform transition
    const transition: StateTransition = {
      from: this.currentState,
      to: targetState,
      timestamp: Date.now(),
      reason
    };

    this.previousState = this.currentState;
    this.currentState = targetState;
    this.stateHistory.push(transition);

    // Notify listeners
    this.notifyListeners(transition);

    return true;
  }

  /**
   * Force transition (bypass validation) - use with caution
   */
  forceTransition(targetState: DatabaseState, reason: string): void {
    console.warn(`FORCE transition: ${this.currentState} -> ${targetState}. Reason: ${reason}`);
    
    const transition: StateTransition = {
      from: this.currentState,
      to: targetState,
      timestamp: Date.now(),
      reason: `FORCED: ${reason}`
    };

    this.previousState = this.currentState;
    this.currentState = targetState;
    this.stateHistory.push(transition);
    this.notifyListeners(transition);
  }

  /**
   * Get state history
   */
  getHistory(limit?: number): StateTransition[] {
    if (limit) {
      return this.stateHistory.slice(-limit);
    }
    return [...this.stateHistory];
  }

  /**
   * Clear state history
   */
  clearHistory(): void {
    this.stateHistory = [];
  }

  /**
   * Add state change listener
   */
  addListener(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    // Return unsubscribe function
    return () => this.listeners.delete(listener);
  }

  /**
   * Remove all listeners
   */
  clearListeners(): void {
    this.listeners.clear();
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners(transition: StateTransition): void {
    for (const listener of this.listeners) {
      try {
        listener(transition);
      } catch (error) {
        console.error('State change listener error:', error);
      }
    }
  }

  /**
   * Check if database is ready for operations
   */
  isReady(): boolean {
    return this.isOneOf(
      DatabaseState.CONNECTED,
      DatabaseState.SYNCING,
      DatabaseState.OFFLINE // Offline mode still allows operations
    );
  }

  /**
   * Check if database is in a terminal error state
   */
  isError(): boolean {
    return this.is(DatabaseState.ERROR);
  }

  /**
   * Check if database is destroyed
   */
  isDestroyed(): boolean {
    return this.is(DatabaseState.DESTROYED);
  }

  /**
   * Check if database is currently syncing
   */
  isSyncing(): boolean {
    return this.is(DatabaseState.SYNCING);
  }

  /**
   * Check if database is online
   */
  isOnline(): boolean {
    return this.isOneOf(
      DatabaseState.CONNECTED,
      DatabaseState.SYNCING,
      DatabaseState.RECONNECTING
    );
  }

  /**
   * Check if database is offline
   */
  isOffline(): boolean {
    return this.is(DatabaseState.OFFLINE);
  }

  /**
   * Get diagnostic information
   */
  getDiagnostics(): {
    currentState: DatabaseState;
    previousState: DatabaseState | null;
    isReady: boolean;
    isOnline: boolean;
    transitionCount: number;
    recentTransitions: StateTransition[];
  } {
    return {
      currentState: this.currentState,
      previousState: this.previousState,
      isReady: this.isReady(),
      isOnline: this.isOnline(),
      transitionCount: this.stateHistory.length,
      recentTransitions: this.getHistory(5)
    };
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.currentState = DatabaseState.UNINITIALIZED;
    this.previousState = null;
    this.stateHistory = [];
  }
}
