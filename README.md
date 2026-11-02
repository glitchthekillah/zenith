# Zenith

Watch, read and request from your own servers, in one app.

Zenith connects to the servers you (or a friend) already run:

| Server | What you get |
| --- | --- |
| **Jellyfin** | Movies, shows and anime: browse, search, continue watching, next up, and a full video player |
| **Kavita** | Books, manga and comics: a reader with page, two-page and long-strip modes |
| **Seerr** (Jellyseerr, Overseerr) | Request movies, shows and anime |
| **An ask site** (like zenith's) | Request movies, shows, anime, books, manga and comics |

Nothing goes through anyone else: the app talks only to the servers you sign in to.

## Download

Get the newest version from the [Releases page](../../releases/latest).

- **Windows:** `Zenith-Setup-x.y.z.exe`. Updates install by themselves.
- **Linux, any distro (Bazzite, SteamOS, Fedora, Arch...):** `Zenith-x.y.z-x86_64.AppImage`. Make it executable (right click, Properties, "Allow executing", or `chmod +x Zenith-*.AppImage`) and open it. Updates install by themselves.
- **Linux Mint, Ubuntu, Debian:** `Zenith-x.y.z-amd64.deb`. Double-click to install. The app tells you when a new version is out.

On Bazzite and other immutable systems, use the AppImage. Gear Lever (from Flathub) can add it to your app menu.

## Features

**Watching**
- Home with a rotating spotlight, Continue watching, Next up, and what's new in each library
- Libraries with filters (not watched, in progress, favorites), genres, sorting and shuffle
- Show pages with seasons and episodes, cast, similar titles, trailers, mark watched, favorites
- Player built for the app:
  - plays the original file when it can, and asks the server to convert it when it can't
  - subtitles (with size control), audio tracks, quality, playback speed
  - chapter marks and preview thumbnails on the seek bar (Jellyfin trickplay)
  - skip intro and credits (Jellyfin 10.10 media segments or the Intro Skipper plugin)
  - "Up next" and automatic next episode
  - progress synced with Jellyfin, so you can continue on any device
- **Picture in picture:** the mini player keeps the video in a small window on top of everything else (desktop app), and the browser's own picture in picture works too
- Keep any window on top with the pin button in the title bar
- Downloads for offline viewing (desktop app)
- Media keys and your system's media controls work
- Your Discord status can show what you're watching (optional)

**Reading**
- Keep reading, recently added, and every library
- Manga and comics: one page, two pages, or a long strip, left to right or right to left, fit to width or height
- Books (EPUB): chapters list, text size, night, sepia and paper colors
- Progress synced with Kavita; the next chapter opens when you reach the end

**Requesting**
- Trending, movies, shows, anime and upcoming lists; books, manga and comics with an ask site
- Pick which seasons or volumes you want, and the quality (ask site)
- My requests, with a notification when something you asked for is ready

**Everything else**
- One search box for your servers and for things to request
- Dark and light themes
- Sign in with a password or Jellyfin Quick Connect
- Works in a web browser too (see below)

### Keyboard

| Key | Does |
| --- | --- |
| Space or K | Play / pause |
| Left / Right | Back 10 s / forward 30 s (hold Shift for more) |
| Up / Down | Volume |
| F | Full screen |
| M | Mini player (desktop) |
| P | Picture in picture |
| C | Subtitles |
| N | Next episode |
| 0 to 9 | Jump to 0% to 90% |
| < and > | Slower / faster |
| / | Search |

## Run it in a web browser

The same app runs as a website. It needs a small server so your browser can reach your media servers:

```
npm install
ZENITH_HOSTS=https://jellyfin.example.com,https://kavita.example.com,https://seerr.example.com PORT=8484 npm run web
```

`ZENITH_HOSTS` lists the only servers it will talk to. Put it behind HTTPS (Caddy, nginx or Tailscale Serve) if other people use it.

## For developers

```
npm install
npm start               # run the desktop app
npm run web             # run the web version
node tests/mock-servers.js   # fake Jellyfin, Kavita and ask servers for testing
```

The interface is plain HTML, CSS and JavaScript modules in `app/`, with no build step. `electron/` is the desktop shell, `server/serve.js` the web server, and `shared/http.js` the request code both use.

### Releasing a new version

1. Change `version` in `package.json` (for example `0.2.0`) and commit.
2. Tag it and push: `git tag v0.2.0 && git push origin main v0.2.0`
3. GitHub Actions builds the Windows installer, the AppImage and the .deb, and publishes them as a release. Installed apps pick it up within a few hours, or right away from Settings, Check now.

### Discord status (optional)

Create an application at the [Discord Developer Portal](https://discord.com/developers/applications), upload an image named `zenith` under Rich Presence, Art Assets, and put the application ID in `package.json` under `zenith.discordClientId`.

## Credits

- [hls.js](https://github.com/video-dev/hls.js) (Apache 2.0) for converted streams
- Inter, Space Grotesk and JetBrains Mono fonts (SIL Open Font License)
- Built on [Electron](https://www.electronjs.org)

Not affiliated with Jellyfin, Kavita or Seerr.

## License

MIT
