import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ProjectProvider } from './context/ProjectContext';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
// NOTE: React.StrictMode is intentionally omitted.
// Monaco Editor is incompatible with StrictMode's double-invoke behavior in React 18.
root.render(
  <ProjectProvider>
    <App />
  </ProjectProvider>
);