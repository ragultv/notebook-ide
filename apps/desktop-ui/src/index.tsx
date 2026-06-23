import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ProjectProvider } from './context/ProjectContext';

import { SettingsWindowApp } from './components/Settings/SettingsWindowApp';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

const urlParams = new URLSearchParams(window.location.search);
const isSettingsView = urlParams.get('view') === 'settings';

root.render(
  isSettingsView ? (
    <SettingsWindowApp />
  ) : (
    <ProjectProvider>
      <App />
    </ProjectProvider>
  )
);