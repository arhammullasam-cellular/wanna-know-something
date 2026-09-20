# Wanna Know Something...

A GitHub Pages-ready two-player question game with a midnight/purple pixel aesthetic.

## What is included

- Polished responsive landing page and game UI
- Create room / join room flow
- 520-question bank generated from 26 topic banks × 20 question prompts
- Private answers + reveal flow
- Reactions, favorites, custom questions, room settings
- Compatibility/vibe summary
- Local session history support
- Share actions using the Web Share API with clipboard fallback
- Settings drawer for particles, glow, animations, pixels, reduced motion, text size, contrast, sound, and themes
- PWA manifest + offline app shell
- Firebase Auth + Firestore realtime multiplayer wiring
- Demo Mode when Firebase is not configured
- Firestore Security Rules
- GitHub Pages static deployment

## Folder structure

```text
wanna-know-something/
├── index.html
├── styles.css
├── app.js
├── questions.js
├── firebase-config.js
├── firestore.rules
├── manifest.json
├── sw.js
├── privacy.html
├── 404.html
├── .nojekyll
├── assets/
│   ├── favicon.svg
│   ├── icon-192.svg
│   └── icon-512.svg
└── .github/
    └── workflows/
```

## 1. Run it immediately

You can open `index.html` through a local static server or upload the entire folder to GitHub Pages.

Without Firebase configuration, the site automatically uses **Demo Mode**. You can explore the complete visual/game flow without creating a backend project.

## 2. Connect live multiplayer

Create a Firebase project and register a Web App in the Firebase console. Firebase's current web setup docs recommend the modular JavaScript SDK; this project uses browser modules so it remains build-tool-free and GitHub Pages-friendly.

Then open `firebase-config.js` and replace every `YOUR_...` value with the config from your Firebase Web App.

Enable:

1. Firebase Authentication → Sign-in method → Anonymous
2. Firestore Database
3. Deploy the rules in `firestore.rules`

### Firestore rules

Copy `firestore.rules` into the Firebase console's Firestore Rules editor, or deploy it through the Firebase CLI.

## 3. Publish on GitHub Pages

GitHub Pages can publish static HTML/CSS/JavaScript directly from a repository. For the simplest deployment:

1. Create a GitHub repository.
2. Put the contents of this folder at the repository root.
3. Push to `main`.
4. Open **Settings → Pages**.
5. Choose **Deploy from a branch**.
6. Select `main` and `/(root)`.
7. Save.

The `.nojekyll` file is included so GitHub Pages treats this as a plain static site.

## Important Firebase note

The Firebase web config is not the same thing as a service-account private key. Do not put private credentials or service-account JSON in this repository. Use Firestore Security Rules and Firebase Auth to protect your data.

## 4. Before public launch

Customize `privacy.html` with your final privacy notice and data retention practices.

Add a Firebase App Check strategy if you expect public traffic.

Consider adding room-expiration cleanup with a trusted server-side job/Cloud Function so abandoned rooms do not remain indefinitely.

Review the answer text you collect. Avoid asking players to share passwords, financial details, exact addresses, or other sensitive information.

## Demo Mode

Demo Mode is intentionally built in. It lets you test the UI and the complete question/reveal/result loop before Firebase is connected.

## Notes

The compatibility score in this build is a lightweight client-side text-overlap heuristic, not an AI personality assessment. It is there for fun and should not be presented as a scientific measurement.
