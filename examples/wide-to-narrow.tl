# axis-motion example timeline.
# Ubuntu Sans is the only variable family installed on this machine.
font     /usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf
text     "Axis Motion"
name     axisWave
duration 1200ms
stagger  60ms
easing   ease-in-out

@0%    wght 100, wdth 100
@50%   wght 800, wdth 75  [cubic-bezier(0.4, 0, 0.2, 1)]
@100%  wght 100, wdth 100
