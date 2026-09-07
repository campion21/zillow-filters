Generate icons (ImageMagick):

    magick -size 128x128 xc:'#0c84ff' -fill white -gravity center \
      -pointsize 72 -annotate 0 'F' icon-128.png
    magick icon-128.png -resize 48x48 icon-48.png
    magick icon-128.png -resize 16x16 icon-16.png

Manifest expects: icons/16.png, icons/48.png, icons/128.png.
(Fire emoji assets from an open source like Twemoji also work well.)
