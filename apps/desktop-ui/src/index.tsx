import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
// NOTE: React.StrictMode is intentionally omitted.
// Monaco Editor is incompatible with StrictMode's double-invoke behavior in React 18:
// setModel() triggers background tokenization via requestIdleCallback, which then fires
// a render pass before the editor's domNode is re-attached to the document.
// This causes: "Cannot read properties of undefined (reading 'domNode')"
root.render(<App />);