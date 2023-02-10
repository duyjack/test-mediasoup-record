FROM node:16 AS stage-one

# Install DEB dependencies and others.
RUN \
	set -x \
	&& apt-get update \
	&& apt-get install -y net-tools build-essential python3 python3-pip valgrind \
    && apt-get install -y libgstreamer1.0-0 \
                    gstreamer1.0-plugins-base \
                    gstreamer1.0-plugins-good \
                    gstreamer1.0-plugins-bad \
                    gstreamer1.0-plugins-ugly \
                    gstreamer1.0-libav \
                    gstreamer1.0-doc \
                    gstreamer1.0-tools \
                    gstreamer1.0-x \
                    gstreamer1.0-alsa \
                    gstreamer1.0-gl \
                    gstreamer1.0-gtk3 \
                    gstreamer1.0-qt5 \
                    gstreamer1.0-pulseaudio


# Create app directory
WORKDIR /usr/src/app


# Bundle app source
COPY . .

# install modules
RUN npm install

EXPOSE 3000

# run server
CMD ["/bin/bash", "start.sh"]