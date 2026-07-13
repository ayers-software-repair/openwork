Howland 1.0.0

Cowork, artifacts, and code on your own hardware. Free and private. One release carries every
download: the desktop clients, the server, and the mobile apps when store signing lands.

Howland Server
- A menu bar / system tray app. Run it on the machine that hosts the models and the Library; it
  sets up and keeps the shared services running and opens every dashboard: the hub, the Library,
  the offline world map, and the monitor.
- Attach-first: a service already running is left untouched.
- /connect: your box configures any other machine on your network with one command.
- Thin or full: the installer below pulls content to your drives, or build a Howland Drive with
  howland-setup bundle for fully offline installs.
- macOS (universal) is the supported server platform today. Windows and Linux server builds are
  preview: the tray and hub run, but the model engine is not wired up on those systems yet.

Howland Desktop
- Chat, artifacts, and a coding agent that edits the files on your machine, thinking on your
  server's models. Both Mac architectures ship: Howland-macOS.dmg is Apple Silicon,
  Howland-macOS-Intel.dmg is Intel.

Howland Mobile
- iOS and Android apps that connect to your machines. Built and pipeline proven; they publish
  here the moment app store signing is in place.

Verify a download: each family publishes a SHA256SUMS file on this release (sha256sum -c).
Installers are unsigned for now; expect an unidentified developer prompt on first launch.
Something broken? File it: https://github.com/ayers-software-repair/howland-releases/issues
