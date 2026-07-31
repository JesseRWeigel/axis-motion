# The timeline the browser check asserts against. Linear easing and one
# axis, so the expected value at any instant is arithmetic a reader can
# do in their head: wght goes 100 to 800 over 1000ms.
font     /usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf
text     "ABC"
name     linearWght
duration 1000ms
stagger  200ms
easing   linear

@0%   wght 100
@100% wght 800
