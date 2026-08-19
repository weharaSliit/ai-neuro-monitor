import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app' // This points to your app.jsx
import './index.css' // We'll create this for Tailwind next

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)