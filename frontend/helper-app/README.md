# Helper — Accessibility Task Manager

Helper is a React Native / Expo app designed to help people with disabilities complete their daily tasks. It has two distinct modes: a simple, distraction-free **user view** for the person with a disability, and a PIN-protected **carer view** for parents or support workers to manage tasks.

---

## Tech Stack

| Layer       | Technology                                                                               |
| ----------- | ---------------------------------------------------------------------------------------- |
| Framework   | [Expo](https://expo.dev) (SDK 54) with [Expo Router](https://expo.github.io/router) v6  |
| Language    | TypeScript (strict mode)                                                                 |
| Navigation  | File-based routing via Expo Router — Stack + Tabs navigators                            |
| State       | React Context (`TasksContext`) — no external state library                              |
| Styling     | React Native `StyleSheet` with a `makeStyles(C)` theming pattern                        |
| Icons       | SF Symbols on iOS (`expo-symbols`), Material Icons on Android/web (`@expo/vector-icons`) |
| Animations  | React Native `Animated` API (no third-party animation library)                          |
| Camera      | `expo-camera` — live front-facing camera feed on the task detail screen                 |

---

## Running the App

```bash
cd helper-app
npm install
npx expo start
```

Open in iOS Simulator, Android Emulator, or Expo Go. The app is primarily designed and tested for iOS.

---

## Project Structure

```
helper-app/
├── app/                         # All screens and navigation (Expo Router)
│   ├── _layout.tsx              # Root Stack navigator; wraps everything in TasksProvider
│   ├── modal.tsx                # Unused modal placeholder from Expo starter
│   │
│   ├── (tabs)/                  # Tab group (tab bar is hidden — only used for routing)
│   │   ├── _layout.tsx          # Tab navigator config; tabBarStyle: display:none
│   │   └── index.tsx            # USER HOME SCREEN — task list, carer access button
│   │
│   ├── task/
│   │   └── [id].tsx             # TASK DETAIL SCREEN — camera feed, AI guidance, complete/undo
│   │
│   └── carer/
│       ├── _layout.tsx          # Carer Stack navigator (headerShown: false)
│       ├── index.tsx            # CARER PIN SCREEN — number pad, 4-digit code entry
│       └── tasks.tsx            # CARER MANAGEMENT SCREEN — add, edit, delete tasks
│
├── context/
│   └── tasks-context.tsx        # Global task state; TasksProvider + useTasks hook
│
├── components/
│   ├── haptic-tab.tsx           # Tab button wrapper that triggers haptic feedback on press
│   ├── themed-text.tsx          # Text component that reads colour from theme
│   ├── themed-view.tsx          # View component that reads background from theme
│   ├── collapsible.tsx          # Expandable/collapsible content section
│   ├── external-link.tsx        # Pressable that opens a URL in the system browser
│   ├── parallax-scroll-view.tsx # ScrollView with parallax header (Expo starter demo, unused)
│   └── ui/
│       ├── icon-symbol.ios.tsx  # iOS icon component — wraps expo-symbols SymbolView
│       └── icon-symbol.tsx      # Android/web fallback — maps SF Symbol names to MaterialIcons
│
├── constants/
│   └── theme.ts                 # Colour palette (light + dark) and platform font stacks (Fonts)
│
├── hooks/
│   ├── use-color-scheme.ts      # Returns 'dark' (hardcoded — app is locked to dark mode)
│   ├── use-color-scheme.web.ts  # Web variant — wraps React Native's useColorScheme with SSR hydration guard
│   └── use-theme-color.ts       # Resolves a named colour token to its light/dark value
│
└── assets/
    ├── fonts/                   # Custom font files (SpaceMono)
    └── images/                  # App icon, splash screen, and other static images
```

---

## Permissions

### Camera (`expo-camera`)

The app requests camera access when the user opens a task detail screen. This is declared in `app.json` via the `expo-camera` plugin:

```json
["expo-camera", {
  "cameraPermission": "This app uses the camera so an AI guide can watch and help you complete your tasks."
}]
```

On iOS and Android the system permission dialog shows this string the first time the user opens a task. If permission is denied, the camera area shows an "Allow Camera" button that re-triggers the system prompt. The permission is managed with `expo-camera`'s `useCameraPermissions` hook inside `app/task/[id].tsx`.

---

## AI Guide

The task detail screen includes a live front-facing camera feed that acts as an AI guide. When the user opens a task:

1. The `CameraView` component (facing `"front"`) is rendered in a 220px card at the top of the screen.
2. After a 2-second warmup, and then every 10 seconds, a photo is captured via `cameraRef.current.takePictureAsync()`.
3. The base64-encoded image and the task's `text` are sent as a POST request to `AI_GUIDE_API_URL` (a constant at the top of `app/task/[id].tsx` — currently empty string; configure this to connect an AI backend).
4. If the response includes a `guidance` field, it is shown in a highlighted card above the task title.

The `aiBadge` overlay on the camera shows "AI Guide Active" (green dot) while idle, and "Analysing…" (blue dot) while a request is in flight. API errors are silently swallowed — if the URL is not configured the feature does nothing.

---

## Data Model

Tasks are stored in React Context (in-memory; resets on app restart).

```ts
interface Task {
  id: string;        // Date.now().toString() — unique identifier
  text: string;      // Task description
  completed: boolean;
  time?: string;     // Optional display time, e.g. "9:00 AM"
}
```

### Context API (`useTasks`)

| Function                  | Who uses it | Description                        |
| ------------------------- | ----------- | ---------------------------------- |
| `tasks`                   | Both        | Full array of all tasks            |
| `getTask(id)`             | User        | Look up a single task by ID        |
| `toggleTask(id)`          | User        | Toggle `completed` true/false      |
| `addTask(task)`           | Carer       | Append a new task (assigns `id`)   |
| `updateTask(id, updates)` | Carer       | Patch `text` or `time`             |
| `deleteTask(id)`          | Carer       | Remove a task permanently          |

---

## User Roles

### End User (person with disability)

- Sees the task list homepage with the day and date
- Taps a task to open its detail screen
- The detail screen shows a live camera feed with AI guidance (if configured)
- Can mark a task **complete** or **incomplete** — that is the only interaction available
- Cannot add, edit, or delete tasks
- No visible navigation bar

### Carer / Parent

- Accesses carer mode via a small semi-transparent settings icon (top-right of the homepage header)
- Enters the 4-digit PIN (`1234` — configurable in `app/carer/index.tsx`)
- On the management screen they can:
  - **Add** new tasks (name required; time is optional)
  - **Edit** existing tasks (sheet pre-fills with current values)
  - **Delete** tasks
- Pressing "Exit" returns to the user homepage

---

## Navigation Flow

```
(tabs)/index          — User task list (home)
  │
  ├── /task/[id]      — Task detail (back → home)
  │
  └── /carer          — Carer PIN entry
        │
        └── /carer/tasks  — Carer task management (back → home)
```

Navigation is handled with Expo Router's `router.push()` and `router.back()`. The carer PIN screen uses `router.replace('/carer/tasks')` on success so the back button from the management screen goes directly to home (not back through the PIN screen).

---

## Design System

### Colours (`constants/theme.ts`)

The `Colors` object has `light` and `dark` variants. The app is currently locked to dark mode — `hooks/use-color-scheme.ts` returns `'dark'` unconditionally, and `app.json` sets `"userInterfaceStyle": "dark"`. The task detail screen also references `Colors.dark` directly.

Every other screen calls `makeStyles(C)` where `C = Colors[colorScheme]`, so styles are computed with the correct palette if the scheme ever changes.

**Light palette**

| Token          | Value       | Purpose                                                  |
| -------------- | ----------- | -------------------------------------------------------- |
| `primary`      | `#2563EB`   | Header backgrounds, buttons, icons, active states        |
| `primaryLight` | `#EFF6FF`   | Soft tinted backgrounds (e.g. time badge, undo button)   |
| `background`   | `#F0F7FF`   | Screen background                                        |
| `card`         | `#FFFFFF`   | Task cards, sheets                                       |
| `cardBorder`   | `#BFDBFE`   | Card outlines, dividers                                  |
| `text`         | `#0F172A`   | Body text                                                |
| `muted`        | `#64748B`   | Secondary text, empty states, inactive icons             |
| `success`      | `#22C55E`   | "Mark Complete" button, completion banner                |
| `secondary`    | `#14B8A6`   | Accent / teal                                            |

**Dark palette** (currently active)

| Token          | Value       | Purpose                                     |
| -------------- | ----------- | ------------------------------------------- |
| `primary`      | `#3B82F6`   | Buttons, active states                      |
| `background`   | `#0C1322`   | Screen background                           |
| `card`         | `#152035`   | Task cards, camera placeholder, sheets      |
| `cardBorder`   | `#1E3A5F`   | Card outlines                               |
| `text`         | `#E2E8F0`   | Body text                                   |
| `success`      | `#4ADE80`   | Completion actions                          |

### Styling pattern

All `StyleSheet` objects are created inside a `makeStyles(C)` function rather than at module level. This means each render picks up the correct colours for the active colour scheme without needing hooks inside `StyleSheet.create`.

```ts
function makeStyles(C: (typeof Colors)['light']) {
  return StyleSheet.create({ ... });
}

// Inside the component:
const s = makeStyles(C);
```

### Accessibility

- All interactive elements have `accessibilityLabel` and `accessibilityRole`
- Touch targets are a minimum of 76px tall
- Completed tasks are greyed out (opacity 0.45) rather than hidden, so users can see their progress
- Text sizes are 17–48px; no text is smaller than 13px
- The PIN screen uses large (72px) number pad keys
- The camera view has an `accessibilityLabel` describing its purpose to screen readers

---

## Carer PIN

The PIN is currently hardcoded as `CARER_PIN = '1234'` in [app/carer/index.tsx](app/carer/index.tsx). The intention is to replace this with a dynamic code-creation flow in a future release.
