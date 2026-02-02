import { useCallback } from 'react';
import { useMatchNotification } from '../context/MatchNotificationContext';
import { logger } from '../services/logger';

/**
 * Hook personalizado para verificar matches antes de ejecutar acciones del usuario
 * 
 * Este hook proporciona una función que verifica si hay matches en las salas activas
 * antes de ejecutar cualquier acción del usuario. Si se encuentra un match, se muestra
 * una notificación y se bloquea la acción original. Si no hay matches, se ejecuta
 * la acción normalmente.
 */
export function useProactiveMatchCheck() {
  const { checkForMatchesBeforeAction, isCheckingMatches, addActiveRoom, removeActiveRoom, clearActiveRooms } = useMatchNotification();

  /**
   * Ejecuta una acción después de verificar si hay matches
   * @param action - Función a ejecutar si no hay matches
   * @param actionName - Nombre descriptivo de la acción para logging
   */
  const executeWithMatchCheck = useCallback(async (
    action: () => void, 
    actionName: string = 'user action'
  ) => {
    logger.userAction(`Executing action with match check: ${actionName}`);
    await checkForMatchesBeforeAction(action, actionName);
  }, [checkForMatchesBeforeAction]);

  /**
   * Wrapper para navegación que incluye verificación de matches
   * @param navigationAction - Función de navegación a ejecutar
   * @param screenName - Nombre de la pantalla de destino
   */
  const navigateWithMatchCheck = useCallback(async (
    navigationAction: () => void,
    screenName: string
  ) => {
    await executeWithMatchCheck(navigationAction, `Navigate to ${screenName}`);
  }, [executeWithMatchCheck]);

  /**
   * Wrapper para acciones de botones que incluye verificación de matches
   * @param buttonAction - Función del botón a ejecutar
   * @param buttonName - Nombre descriptivo del botón
   */
  const buttonActionWithMatchCheck = useCallback(async (
    buttonAction: () => void,
    buttonName: string
  ) => {
    await executeWithMatchCheck(buttonAction, `Button action: ${buttonName}`);
  }, [executeWithMatchCheck]);

  /**
   * Wrapper para acciones de formularios que incluye verificación de matches
   * @param formAction - Función del formulario a ejecutar
   * @param formName - Nombre descriptivo del formulario
   */
  const formActionWithMatchCheck = useCallback(async (
    formAction: () => void,
    formName: string
  ) => {
    await executeWithMatchCheck(formAction, `Form action: ${formName}`);
  }, [executeWithMatchCheck]);

  return {
    // Función principal
    executeWithMatchCheck,
    
    // Wrappers específicos para diferentes tipos de acciones
    navigateWithMatchCheck,
    buttonActionWithMatchCheck,
    formActionWithMatchCheck,
    
    // Estado
    isCheckingMatches,
    
    // Gestión de salas activas
    addActiveRoom,
    removeActiveRoom,
    clearActiveRooms,
  };
}

/**
 * Tipos de ejemplo para diferentes acciones del usuario
 */
export interface UserActionTypes {
  // Navegación
  NAVIGATE_TO_PROFILE: 'Navigate to Profile';
  NAVIGATE_TO_RECOMMENDATIONS: 'Navigate to Recommendations';
  NAVIGATE_TO_MY_ROOMS: 'Navigate to My Rooms';
  NAVIGATE_TO_MY_MATCHES: 'Navigate to My Matches';
  NAVIGATE_TO_CREATE_ROOM: 'Navigate to Create Room';
  NAVIGATE_TO_JOIN_ROOM: 'Navigate to Join Room';
  NAVIGATE_TO_DASHBOARD: 'Navigate to Dashboard';
  
  // Acciones de botones
  REFRESH_DATA: 'Refresh Data';
  LOGOUT: 'Logout';
  SAVE_PROFILE: 'Save Profile';
  CREATE_ROOM: 'Create Room';
  JOIN_ROOM: 'Join Room';
  
  // Acciones de formularios
  SUBMIT_VOTE: 'Submit Vote';
  UPDATE_PREFERENCES: 'Update Preferences';
  SEARCH_CONTENT: 'Search Content';
}

// Constantes para nombres de acciones comunes
export const ACTION_NAMES = {
  // Navegación
  NAVIGATE_TO_PROFILE: 'Navigate to Profile',
  NAVIGATE_TO_RECOMMENDATIONS: 'Navigate to Recommendations',
  NAVIGATE_TO_MY_ROOMS: 'Navigate to My Rooms',
  NAVIGATE_TO_MY_MATCHES: 'Navigate to My Matches',
  NAVIGATE_TO_CREATE_ROOM: 'Navigate to Create Room',
  NAVIGATE_TO_JOIN_ROOM: 'Navigate to Join Room',
  NAVIGATE_TO_DASHBOARD: 'Navigate to Dashboard',
  
  // Acciones de botones
  REFRESH_DATA: 'Refresh Data',
  LOGOUT: 'Logout',
  SAVE_PROFILE: 'Save Profile',
  CREATE_ROOM: 'Create Room',
  JOIN_ROOM: 'Join Room',
  
  // Acciones de formularios
  SUBMIT_VOTE: 'Submit Vote',
  UPDATE_PREFERENCES: 'Update Preferences',
  SEARCH_CONTENT: 'Search Content',
} as const;