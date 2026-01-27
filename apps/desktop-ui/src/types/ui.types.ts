import React from 'react';

// UI component types
export interface ToastNotification {
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

export interface SidebarSection {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  content: React.ReactNode;
}

export interface DropdownOption {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
}
