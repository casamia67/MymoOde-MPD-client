# MymoOde-MPD-client

**Mymoode MPD Client** is an alternative, lightweight, and highly customizable web frontend interface developed to interact with **moOde Audio Player** and **MPD (Music Player Daemon)** on a Raspberry Pi environment. 

Born from a passion for high fidelity and historical design, this project combines modern digital music library management with a nostalgic visual experience, introducing dynamic screensavers that faithfully recreate the aesthetics of vintage radios and great classic Hi-Fi amplifiers.

## 🚀 Main Features

* **Complete Library Management:** Smooth music exploration by Albums, Artists, Folders (including NAS and USB), and advanced Web Radio management (with the ability to add custom stations and logos).
* **Adaptive (Responsive) Interface:** Layout designed to automatically scale and reorganize based on the device in use, featuring optimized views for Desktop (1080p), Tablet (landscape/portrait), and Smartphone.
* **Local Playback (HTTP Stream):** Ability to listen to the music playing on the Raspberry Pi directly through the client device's speakers (smartphone or PC) via HTTP stream.
* **Integrated Search Engine:** Quick search with specific filters (Title, Album, Artist, Genre, Folder, Radio) supported by a virtual on-screen keyboard.
* **Playlist and Queue Management:** Create, save, edit, and clear playback queues in real-time.
* **Multilingual Support:** Interface localized in English, Italian, French, and Spanish.

## 🎨 Design, Screensavers, and VU Meters (HTML5 Canvas)

The core strength of Mymoode Client is its screensaver graphics engine, written entirely in JavaScript (Canvas API), capable of reacting in real-time to the audio signal. 

Two main visual categories are included:

1. **Hi-Fi Studio Racks:** Faithful and animated reproductions of VU meters paying homage to the Golden Age of Hi-Fi. Available themes include:
   * *Blue Classic Mod. 70* (Inspired by iconic American blue lighting)
   * *Champagne Gold Mod. 73* (Warm Japanese golden style)
   * *Studio Master Mod. 77* (Strict and professional, Swiss recording studio aesthetic)
   * *VFD Peak Mod. 85* (1980s fluorescent digital display)
   * *And many other minimal, tube, and flat themes.*

2. **Vintage 3D Radios:** Models recreating the lighting, wood, and backlit glass dials of classic European and non-European parlor radios:
   * *Teutonia 54* & *Console '55* (Wooden cabinets and piano keys)
   * *Radica Mod. 58* & *Classic '35* (Dark bakelite and briar root structures)
   * *Solid State '68* (Homage to high-tech Japanese transistors)

## ⚙️ Advanced Technical Integrations

* **CamillaDSP Integration:** Direct control (ON/OFF) of the DSP processor and real-time RMS signal reading via WebSocket to animate the VU Meters with hardware precision, bypassing the limitations of browser audio analysis.
* **Smart Home Ready (API Endpoints):** The system exposes dedicated URLs (e.g., `mpd_bridge.php?action=search&q={TEXT}&autoplay=true`) perfect for being called by **Home Assistant** or **Alexa** (via `rest_command`) to start music playback using voice commands.
* **Global Administration Panel:** Through `admin.html`, it is possible to configure default behaviors (Screensaver timeout, Default theme, Layout) that will be automatically distributed to any new tablet or smartphone connecting to the system.
* **Backup & Restore:** JSON format export and import of all UI preferences, saved radio stations, and user favorites.

## 🛠️ Installation

Installation is simple and automated for Debian/Raspberry Pi OS-based systems (assuming the moOde web environment is already configured on `/var/www/`).

1. Access your Raspberry Pi via SSH.
2. Navigate to the web root folder:
   ```bash
   cd /var/www
   ```
3. Clone the repository:
   ```bash
   git clone [https://github.com/casamia67/mymoode-MPD-client.git](https://github.com/casamia67/mymoode-MPD-client.git) vumeter
   ```
4. Enter the directory and run the installation script:
   ```bash
   cd vumeter
   sudo chmod +x install.sh
   sudo ./install.sh
   ```
5. Open your browser and navigate to `http://[RASPBERRY-IP]/vumeter`

## ⚖️ Disclaimer of Warranty & Trademark Notice

**1. Warranty & Limitation of Liability**
This software, code, and graphical interface are provided **"as is"**, without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and noninfringement. In no event shall the author or copyright holders be liable for any direct, indirect, incidental, special, exemplary, or consequential damages arising from the use, modification, or distribution of this software. **Use entirely at your own risk.**

**2. Trademark Notice**
All product names, logos, brands, trade names, and vintage radio aesthetics referenced, simulated, or visually adapted in this project are the property of their respective trademark holders. Their use within this project is strictly for nostalgic, aesthetic, and artistic representation purposes ("fan art" / historical tribute interface). This project is an independent, non-commercial hobbyist creation for open-source music players and is **not** affiliated, endorsed, sponsored, or officially connected with any of the respective trademark owners. No trademark infringement is intended. Any referenced content will be promptly removed upon request by the copyright or trademark owners.

## 🙏 Acknowledgments & Credits

A special and heartfelt thank you to the **moOde Audio** team for the dedication and high professionalism with which they develop and maintain their audio platform. This client was born as a complementary frontend interface for hobbyist use and would not have been possible without the solid foundation provided by moOde Audio and the **MPD (Music Player Daemon)** ecosystem.

* [moOde Audio Official Website](https://moodeaudio.org)
* Music Player Daemon (MPD)
* To the entire Open Source and DIYAudio community.

{"[00:00]": "Heat heat", "[00:40]": "Heat heat", "[00:50]": "Heat", "[00:57]": "Heat", "[01:07]": "Heat heat", "[01:27]": "Heat heat", "[01:51]": "Heat heat", "[02:12]": "Heat heat", "[02:54]": "Heat heat", "[03:10]": "Hey hey hey hey hey hey hey hey hey hey hey Heat heat", "[04:07]": "Welcome home missing you made me stronger and I'd be Superman if I fly around the world it wouldn't take", "[04:18]": "Me longer then would you be your man i fight a thousand guys live to die a thousand lies oh", "[04:29]": "I'd find another way to make me smarter just so I could understand i'll find what you're looking for just", "[04:41]": "So I could understand", "[04:48]": "Just so I could understand", "[04:55]": "Just so I could understand", "[05:02]": "So I could understand", "[05:09]": "I could understand", "[05:16]": "What it takes to beat your clothes right off my back put the knife against my throat say you even", "[05:27]": "Won't come back but I'll find a way to forget you cut the strings off my guitar stomp your heels", "[05:37]": "Into my toes steal the keys right out my car and I'll find a way to forive you i fight", "[05:47]": "A thousand guys live to die a thousand lives"}

