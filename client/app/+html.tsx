import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <meta name="theme-color" content="#FDF0E0" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#141517" media="(prefers-color-scheme: dark)" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: `
          html, body {
            background-color: #FDF0E0;
          }
          @media (prefers-color-scheme: dark) {
            html, body {
              background-color: #141517;
            }
          }
          #gc-loader {
            position: fixed; inset: 0; z-index: 9999;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center; gap: 26px;
            background: #FDF0E0;
            opacity: 0;
            animation: gc-loader-in 0.2s ease-in 0.5s forwards;
          }
          @keyframes gc-loader-in { to { opacity: 1; } }
          #gc-spinner {
            width: 44px; height: 44px; border-radius: 50%;
            border: 3px solid rgba(232, 114, 12, 0.2);
            border-top-color: #E8720C;
            animation: gc-spin 0.9s cubic-bezier(0.4, 0, 0.6, 1) infinite;
          }
          @keyframes gc-spin { to { transform: rotate(360deg); } }
          #gc-loader-brand {
            display: flex; align-items: center; gap: 18px;
          }
          #gc-loader-logo {
            width: 92px; height: 92px; object-fit: contain;
          }
          #gc-loader-wordmark {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 34px; font-weight: 700; letter-spacing: 0;
            color: rgba(28, 20, 16, 0.9);
          }
          @media (max-width: 480px) {
            #gc-loader-brand { flex-direction: column; gap: 12px; }
            #gc-loader-logo { width: 96px; height: 96px; }
            #gc-loader-wordmark { font-size: 30px; }
          }
          @media (prefers-color-scheme: dark) {
            #gc-loader { background: #141517; }
            #gc-loader-wordmark { color: rgba(243, 235, 221, 0.9); }
            #gc-spinner { border-color: rgba(240, 120, 24, 0.2); border-top-color: #F07818; }
          }
        ` }} />
      </head>
      <body>
        <div id="gc-loader">
          <div id="gc-spinner" />
          <div id="gc-loader-brand">
            <img id="gc-loader-logo" src="/logo-mark.svg" alt="" />
            <div id="gc-loader-wordmark">Pattern Deck</div>
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}
