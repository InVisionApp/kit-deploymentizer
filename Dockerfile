FROM node:6.14.4-alpine

# Install node modules (allows for npm install to be cached until package.json changes)
COPY .npmrc .npmrc
COPY package.json package.json
RUN npm install

# Allow command-line access to all dependencies (eg `gulp`)
ENV \
	PATH=/node_modules/.bin:$PATH \
	CLEAN=true \
	OUTPUT=/generated \
	SAVE=true \
	LOG_NAME=kit-deploymentizer

# Copy our source files to the service location
COPY src /src

VOLUME ["/generated", "/raw"]

ENTRYPOINT ["./src/deploymentizer"]
