# make PS4_PAYLOAD_SDK=/opt/ps4-payload-sdk PS5_PAYLOAD_SDK=/opt/ps5-payload-sdk
# Each SDK's toolchain file sets CC for its console, so each target runs in its own make.
CFLAGS := -Wall -O2

all: zenaa-ps4.elf zenaa-ps5.elf

zenaa-ps5.elf: zenaa.c
	$(MAKE) -f Makefile.ps5 OUT=$@ CFLAGS="$(CFLAGS)"

zenaa-ps4.elf: zenaa.c
	$(MAKE) -f Makefile.ps4 OUT=$@ CFLAGS="$(CFLAGS)"

clean:
	rm -f *.elf
