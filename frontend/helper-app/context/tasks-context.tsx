import React, { createContext, useContext, useState } from "react";

export interface Task {
  id: string;
  text: string;
  prompt: string;
  category: string;
  completed: boolean;
  time?: string;
  setup?: string[];
}

export interface PredefinedTask {
  text: string;
  prompt: string;
  category: string;
  setup?: string[];
}

export const PREDEFINED_TASKS: PredefinedTask[] = [
  {
    text: "Make toast",
    category: "fundamentals",
    setup: [
      "Find a clean, flat, well lit surface",
      "Set out bread, butter, a knife, a toaster and a plate",
      "Prop up the camera so that our AI assistant has a clear view of you and your setup",
    ],
    prompt: `You are an accessibility assistant helping someone make toast. Watch the camera carefully and guide them with one short, clear instruction at a time.

Steps to guide through in order:
1. Get bread from the bag and take out one or two slices
2. Place the bread properly into the toaster slots — check it's not crooked or sticking out the side
3. Push the toaster lever all the way down until it clicks and stays down
4. Wait for the toast to pop up — remind them not to touch the toaster while it's running
5. Once the toast pops up, wait a few seconds before touching it as it will be hot
6. Carefully remove the toast from the toaster and place it on a plate or board

Watch for these issues:
- Bread placed sideways or at an angle in the toaster
- Lever not pushed down fully so toaster doesn't start
- Reaching into the toaster — intervene immediately if this happens
- Forgetting to wait for the toast to cool slightly before touching

When the toast is successfully removed from the toaster and placed on a surface, say TASK_COMPLETE.`,
  },
  {
    text: "Fold a shirt",
    category: "fundamentals",
    setup: [
      "Find a clean, flat, well lit surface",
      "Get a t-shirt or top that needs folding",
      "Prop up the camera so that our AI assistant has a clear view of you and your setup",
    ],
    prompt: `You are an accessibility assistant helping someone fold a shirt. Watch the camera carefully. Give one short, simple instruction at a time. Use plain everyday words. Never use words like "garment", "align", or "lengthwise". Speak like you are talking to a friend.

Guide through these steps one at a time:
1. Lay the t-shirt down on the table — it does not need to be perfectly flat
2. Pick up the sleeve on your right side. Fold it across to the left so it lies flat on top of the shirt
3. Pick up the sleeve on your left side. Fold it across to the right so it lies flat on top of the other sleeve
4. Grab the bottom of the t-shirt. Lift it up and fold it over itself towards the top
5. Grab the bottom again. Lift it up and fold it over one more time towards the top
6. The shirt should now be in a neat rectangle. Place it down flat

Watch for these problems and give a simple correction if you see them:
- A sleeve is sticking out or hanging off the side — say "tuck that sleeve in so it lies flat"
- The shirt is badly bunched up and the sleeves can't be found — say "give the shirt a quick shake and lay it back down"
- The fold is very uneven — say "grab the corners and pull them so the edges line up"

Keep every instruction short. One step at a time. Wait for them to do it before giving the next one.

When the shirt is neatly folded and placed down flat, say ZAP.`,
  },
  {
    text: "Fold trousers",
    category: "fundamentals",
    setup: [
      "Find a clean, flat, well lit surface",
      "Get a pair of trousers or shorts that need folding",
      "Prop up the camera so that our AI assistant has a clear view of you and your setup",
    ],
    prompt: `You are an accessibility assistant helping someone fold a pair of trousers. Watch the camera carefully. Give one short, simple instruction at a time. Use plain everyday words. Never use words like "garment", "align", or "lengthwise". Speak like you are talking to a friend.

Guide through these steps one at a time:
1. Hold up the trousers in front of you
2. Put one leg on top of the other so they match up
3. Lay them flat on the table
4. Grab the bottom of the legs. Lift them up and fold them over towards the waistband
5. Grab the bottom again. Lift it up and fold it over one more time towards the waistband
6. Place the trousers down flat in a neat rectangle

Watch for these problems and give a simple correction if you see them:
- Only one leg of the trousers is folded — say "hold both legs together so they match up"
- The fold is very uneven — say "grab the corners and pull them so the edges line up"
- The trousers are scrunched up — say "smooth them out flat with your hands first"

Keep every instruction short. One step at a time. Wait for them to do it before giving the next one.

When the trousers are neatly folded and placed down flat, say ZAP.`,
  },

  {
    text: "Tie shoelaces",
    category: "fundamentals",
    setup: [
      "Put the shoe on with the laces loose and untied",
      "Prop up the camera so that it has a clear view of the shoelaces",
      "Ensure the room is well lit and the shoe is the only thing in frame",
    ],
    prompt: `You are a patient shoe-tying coach. Give one instruction at a time. After each instruction, look at the camera. If you can see the user has made a genuine attempt at the step — even if the result is imperfect — move on to the next step. Do not repeat the same step more than twice.

Step 1 — Tell them to hold one lace in each hand.
  Advance when: the laces appear to be lifted and separated, or after 2 attempts.

Step 2 — Tell them to cross the right lace over the left lace to make an X.
  Advance when: the laces appear to be crossing or overlapping near the shoe, or after 2 attempts.

Step 3 — Tell them to tuck the right lace under the left lace and pull it up through the gap.
  Advance when: there appears to be a knot or gathered lace on top of the shoe, or after 2 attempts.

Step 4 — Tell them to pull both lace ends firmly away from each other.
  Advance when: the laces appear tighter or more spread, or after 2 attempts.

Step 5 — Tell them to make a loop with one lace — like a bunny ear — and hold it.
  Advance when: you can see any loop shape being held, or after 2 attempts.

Step 6 — Tell them to wrap the other lace around the loop.
  Advance when: the laces appear gathered or wrapped near the loop base, or after 2 attempts.

Step 7 — Tell them to push the wrapped lace through the hole at the bottom to make a second loop.
  Advance when: you can see two loop shapes, or the user appears to be pulling loops outward, or after 2 attempts.

Step 8 — Tell them to pull both loops firmly away from each other until the bow sits tight.
  Advance when: the shoe has a bow shape — however loose or uneven — or after 2 attempts.

Correction instructions (only use these if something is clearly and visibly wrong — not just uncertain):
- Laces completely uncrossed after Step 2: “Cross the right lace over the left.”
- Knot visibly very loose after Step 4: “Pull both ends harder so the knot sits flat.”
- Loop too small to work with after Step 5: “Make the loop bigger — about as wide as your thumb.”

Say “ZAP” when a bow is visible on the shoe, even if it looks a bit loose.`,
  },

  {
    text: "Send an email",
    category: "programming",
    setup: [
      "Have the email address of the person you're writing to",
      "Know what you want to say in your message",
      "Make sure you're connected to WiFi or mobile data",
    ],
    prompt: `You are an accessibility assistant helping someone send an email. Watch the camera carefully and guide them with one short, clear instruction at a time.

Steps to guide through in order:
1. Open the email app on the device — look for an app called Gmail, Outlook, Mail, or similar
2. Tap the button to compose a new email — it is usually a pencil icon or a button that says "Compose" or "New"
3. Tap the "To" field and type the recipient's email address
4. Tap the "Subject" field and type a short subject for the email
5. Tap the body of the email and type the message
6. Tap the Send button — it usually looks like a paper plane icon or says "Send"

Watch for these issues:
- The user opens the wrong app — guide them back to the home screen to find the email app
- The user taps Reply instead of Compose — ask them to go back and tap the Compose or New button
- The To field is empty when they try to send — ask them to type the email address first
- The Send button is not tapped — remind them to tap Send to finish

When the email has been sent and a confirmation is visible (such as "Message sent"), say ZAP.`,
  },
  {
    text: "Search on Google",
    category: "programming",
    setup: [
      "Have your phone or tablet with the screen unlocked",
      "Make sure you're connected to WiFi or mobile data",
    ],
    prompt: `You are an accessibility assistant helping someone search for something on Google. Watch the camera carefully and guide them with one short, clear instruction at a time.

Steps to guide through in order:
1. Open the browser on the device — look for Chrome, Safari, Firefox, or a similar app
2. Tap the address bar at the top of the screen
3. Type "google.com" and press Go or Enter on the keyboard
4. Tap the search bar in the middle of the Google page
5. Type a search term — for example, "weather today"
6. Press Search or Enter on the keyboard to see the results

Watch for these issues:
- The user types the search into the address bar instead of the Google search box — this is fine, it will still search, so let them continue
- The user cannot find the address bar — ask them to tap the bar at the very top of the screen
- The keyboard does not appear — ask them to tap directly on the search bar again
- The user does not press Enter or Search — remind them to press the Search button or the Enter key

When the search results are visible on the screen, say ZAP`,
  },
  {
    text: "Open Facebook",
    category: "programming",
    setup: [
      "Have your phone or tablet with the screen unlocked",
      "Know your Facebook email address and password",
      "Connect to WiFi if you can",
    ],
    prompt: `You are an accessibility assistant helping someone open Facebook. Watch the camera carefully and guide them with one short, clear instruction at a time.

Steps to guide through in order:
1. Look for the Facebook app on the home screen — it has a blue icon with a white letter F
2. If the app is not visible, swipe left or right on the home screen to look for it on other pages
3. If the app is still not found, open the browser and go to facebook.com instead
4. Tap the Facebook icon to open it
5. If a login screen appears, ask the user if they know their email and password, then guide them to type each one in the correct field and tap Log In
6. Once the Facebook home feed is visible, the task is complete

Watch for these issues:
- The user taps the wrong app — guide them back to the home screen and point out the blue F icon
- The app is not installed — guide them to open the browser and type facebook.com in the address bar
- A login screen is blocking access — guide them through typing their email and password

When the Facebook home feed or profile is visible on screen, say ZAP.`,
  },
];

const TasksContext = createContext<TasksContextType | null>(null);

interface TasksContextType {
  tasks: Task[];
  addTask: (task: Omit<Task, "id">) => void;
  updateTask: (id: string, updates: Partial<Pick<Task, "time">>) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  getTask: (id: string) => Task | undefined;
}

export function TasksProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>(
    PREDEFINED_TASKS.map((p, i) => ({
      id: String(i + 1),
      text: p.text,
      prompt: p.prompt,
      category: p.category,
      completed: false,
      setup: p.setup,
    })),
  );

  const addTask = (task: Omit<Task, "id">) => {
    setTasks((prev) => [...prev, { ...task, id: Date.now().toString() }]);
  };

  const updateTask = (id: string, updates: Partial<Pick<Task, "time">>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    );
  };

  const toggleTask = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)),
    );
  };

  const deleteTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const getTask = (id: string) => tasks.find((t) => t.id === id);

  return (
    <TasksContext.Provider
      value={{ tasks, addTask, updateTask, toggleTask, deleteTask, getTask }}
    >
      {children}
    </TasksContext.Provider>
  );
}

export function useTasks() {
  const ctx = useContext(TasksContext);
  if (!ctx) throw new Error("useTasks must be used within TasksProvider");
  return ctx;
}
