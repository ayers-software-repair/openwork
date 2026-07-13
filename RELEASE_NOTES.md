## Howland 1.0.0

Cowork, artifacts, and code on your own hardware. Free and private.

Every download lives on this page. Most people want two things: the server on the machine with
the storage, and the desktop app on the machine where they work.

## Howland Server

The box. Install it on the machine that will hold your models and your library. It lives in the
menu bar or system tray, starts everything for you, and opens each of its pages from one menu:
the hub, the library, the world map, and the monitor.

- Mac: Howland-Server-macOS.dmg (works on Apple Silicon and Intel).
- Windows and Linux server builds are early previews. They run the hub and the library, but not
  the models yet. The Mac is the full server today.
- To connect another machine, open http://YOUR-BOX:31052/connect on it and run the one command
  shown there.
- For a fully offline setup, run: howland-setup bundle /Volumes/YourDrive
  This fills a portable drive with everything, about 860 GB, so you can install on machines that
  never touch the internet.

## Howland Desktop

Chat, artifacts, and a coding agent that works on the files on your machine, using your server
for the thinking.

- Mac with Apple Silicon: Howland-macOS.dmg
- Mac with an Intel chip: Howland-macOS-Intel.dmg
- Windows: Howland-Windows.exe
- Linux: Howland-Linux.AppImage or Howland-Linux.deb

## Howland Mobile

The iPhone, iPad, and Android apps are finished. They appear here the moment our app store
accounts are approved.

## Good to know

- The installers are not signed yet, so your computer will warn about an unidentified developer
  the first time you open one. That warning goes away once signing is in place.
- Every download can be verified against the SHA256SUMS files published on this page.
- Something broken? Tell us: https://github.com/ayers-software-repair/howland-releases/issues
