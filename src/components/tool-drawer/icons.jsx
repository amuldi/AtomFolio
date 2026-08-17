// Small hand-sketched SVG icons used by the tool drawer's tool-picker menu — split out of
// App.jsx (see ToolSideDrawer.jsx) since none of them are referenced outside that one menu.

export function SketchGearIcon() {
  return (
    <svg className="settings-gear__icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        className="settings-gear__outline-soft"
        d="M24.2 7.1l3.2.9 1.4 4.5 4.4-.1 2.3 3-1.8 4.2 3.5 2.4-.8 4-4 1.4-.5 4.2-3.5 2.2-3.7-2.1-3.9 2.3-3.2-2.4.2-4.2-4-1.6-.8-3.7 3.1-2.9-1.8-4.1 2.7-3.2 4.3.2 1.5-4.6z"
      />
      <path
        className="settings-gear__outline-main"
        d="M24.4 6.4l3.5 1 1.3 4.6 4.3.1 2.5 3.1-1.9 4 3.2 2.6-.6 4.1-4.2 1.2-.4 4.3-3.6 2.4-3.6-2.2-4 2.3-3.1-2.7.2-4.1-4.2-1.5-.6-3.8 3.2-2.8-2-4 2.6-3.3 4.4.3 1.4-4.6z"
      />
      <path
        className="settings-gear__center-soft"
        d="M24.3 16.8c4.3-.1 7.1 3.1 7 7.2 0 4.1-2.9 7.1-7 7-3.9 0-6.9-2.9-6.9-7 .1-4.1 3-7.2 6.9-7.2z"
      />
      <path
        className="settings-gear__center-main"
        d="M24.2 17.6c3.8 0 6.2 2.9 6.2 6.5 0 3.7-2.4 6.4-6.1 6.4-3.6 0-6.2-2.6-6.2-6.4s2.5-6.5 6.1-6.5z"
      />
    </svg>
  );
}

export function SketchBurstIcon() {
  return (
    <svg className="group-dock__burst-icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        className="group-dock__burst-soft"
        d="M24.2 5.8L26.8 18L34.8 12.6L30.1 21L41.7 19.2L30.9 24.2L33.2 33.4L26 28.8L24.8 42.7L21.5 29.2L14.2 34.3L18.8 26.1L6.2 24.2L18.2 22.1L11.2 15.3L21.2 18.8Z"
      />
      <path
        className="group-dock__burst-main"
        d="M24.1 6.6L26.1 17.4L33.8 12.4L29.6 20.9L40 19.6L30.4 24.1L32.4 32.2L25.8 28L24.7 40.9L21.8 28.7L15.1 33.4L19.1 25.9L7.6 24L18.5 22L12.2 15.8L21.5 19Z"
      />
      <path
        className="group-dock__burst-core"
        d="M24.4 7.3L26.5 18.4L34 13.5L29.5 21.8L39.1 20.5L30.1 24.5L31.9 31.4L25.8 27.6L24.8 39.6L22.1 28.2L15.8 32.6L19.6 25.6L9 23.9L18.9 22.2L13 16.6L21.7 19.5Z"
        opacity="0.86"
      />
    </svg>
  );
}

export function SketchTwinIcon() {
  return (
    <svg className="twin-dock__icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        className="twin-dock__orbit-soft"
        d="M10.6 25.4C13.7 14.6 24.5 8.8 34 12.1C42.7 15.2 43.8 25.3 36.5 32.1C28.6 39.4 16 40.5 11.5 32.5C10.1 30 9.8 27.7 10.6 25.4Z"
      />
      <path
        className="twin-dock__orbit-main"
        d="M11.8 25.1C14.8 15.6 24.1 10.4 32.5 13.3C40.2 16 41.6 24.7 35 30.9C27.9 37.6 17.1 38.3 13 31.3C11.8 29.2 11.2 27.1 11.8 25.1Z"
      />
      <path
        className="twin-dock__orbit-soft"
        d="M13.4 14.9C21.2 9.1 32.1 11.9 35.3 21.2C38.3 29.9 31.1 38.1 21.1 36.3C11.8 34.6 7.7 25.8 13.4 14.9Z"
        opacity="0.42"
      />
      <path
        className="twin-dock__node-soft"
        d="M23.7 17.9C27.7 17.6 30.6 20.5 30.7 24.1C30.8 28.2 27.8 31.1 23.8 31C19.8 31 17.2 28.3 17.3 24.4C17.4 20.7 20 18.2 23.7 17.9Z"
      />
      <path
        className="twin-dock__node-main"
        d="M24 18.9C27.2 18.7 29.5 21 29.5 24.1C29.5 27.5 27.2 29.8 24 29.8C20.8 29.8 18.6 27.5 18.7 24.4C18.8 21.3 20.9 19.1 24 18.9Z"
      />
      <circle className="twin-dock__spark" cx="34.4" cy="15.6" r="2.1" />
      <circle className="twin-dock__spark" cx="13.6" cy="31.2" r="1.6" />
    </svg>
  );
}

export function SketchAccountStackIcon() {
  return (
    <svg className="account-dock__icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        className="account-dock__soft"
        d="M13.2 12.6C18.1 9.5 29.2 9.8 34.9 12.9C39.7 15.6 39 20.1 33.7 22.1C27.5 24.4 16.6 23.8 12.4 20.2C9.5 17.7 10.1 14.5 13.2 12.6Z"
      />
      <path
        className="account-dock__main"
        d="M14.1 13.4C18.7 10.8 28.3 11 33.5 13.6C37.3 15.5 36.9 18.5 32.7 20.2C27.1 22.4 17.5 21.8 13.6 18.9C11.4 17.3 11.8 14.7 14.1 13.4Z"
      />
      <path
        className="account-dock__soft"
        d="M11.9 21.2C16.1 25.1 28.8 25.8 35.4 22.7L35 28.2C29.5 32 17.4 31.6 12 27.4L11.9 21.2Z"
        opacity="0.55"
      />
      <path
        className="account-dock__main"
        d="M13.1 22.3C17.5 25.5 28 26 34 23.4L33.7 27.4C28.5 30.3 18.2 30 13.2 26.7L13.1 22.3Z"
      />
      <path
        className="account-dock__soft"
        d="M12.4 30.3C17.9 34.2 29 34.7 35.2 31.2L34.8 35.4C28.7 39 17.5 38.2 12.6 34.7L12.4 30.3Z"
      />
      <path
        className="account-dock__main"
        d="M13.6 30.9C18.7 33.8 28.4 34.2 33.8 31.8L33.6 34.6C28.4 37.2 18.8 36.7 13.7 33.9L13.6 30.9Z"
      />
    </svg>
  );
}

export function SketchManualAccountIcon() {
  return (
    <svg className="manual-dock__icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        className="manual-dock__soft"
        d="M12.5 13.6C17.1 10.5 30.2 10.7 35.8 13.9C39.5 16 38.8 19.3 34.2 20.8C28.4 22.7 17.1 22.1 12.8 19.1C9.7 16.9 10.3 15 12.5 13.6Z"
      />
      <path
        className="manual-dock__main"
        d="M14.4 15C18.5 12.8 28.7 12.8 33.5 15.2C36.2 16.6 35.6 18.5 32.7 19.5C27.5 21.1 18.5 20.8 14.5 18.4C12.5 17.2 12.7 15.9 14.4 15Z"
      />
      <path
        className="manual-dock__soft"
        d="M13.1 22.8C17.9 26 29.6 26.4 34.8 23.7L34.2 34.1C29.2 37.4 18.7 37.1 13.5 33.5L13.1 22.8Z"
      />
      <path
        className="manual-dock__main"
        d="M15.1 24.1C19.5 26.3 28.4 26.6 32.8 24.6L32.4 32.8C28 34.8 20.1 34.7 15.5 32.3L15.1 24.1Z"
      />
      <path className="manual-dock__main" d="M19.1 29.3L22.6 31.8L29.7 25.7" />
      <path className="manual-dock__accent" d="M34.3 10.8L34.3 17.6M30.9 14.2L37.7 14.2" />
    </svg>
  );
}

export function SketchNewsIcon() {
  return (
    <svg className="news-dock__icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        className="news-dock__soft"
        d="M12.2 13.4C18.4 10.7 30.4 10.2 36.2 13.8L35.5 35.5C29.7 32.3 19.4 32.4 12.7 35.8L12.2 13.4Z"
      />
      <path
        className="news-dock__main"
        d="M14.3 14.8C19.6 12.8 29.2 12.7 33.9 15.1L33.4 32.9C28.2 30.8 20.1 30.9 14.8 33.2L14.3 14.8Z"
      />
      <path className="news-dock__main" d="M18.4 19.2L29.6 18.7" />
      <path className="news-dock__main" d="M18.4 23.8L30.1 23.4" />
      <path className="news-dock__main" d="M18.6 28.3L26.8 27.9" />
      <path className="news-dock__accent" d="M34.4 10.5C37.4 11.5 39.1 14.3 38.5 17.4" />
      <path className="news-dock__accent" d="M37.9 22.1C40.1 24.5 39.9 28.2 37.4 30.4" />
    </svg>
  );
}
