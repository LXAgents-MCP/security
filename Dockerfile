# syntax=docker/dockerfile:1

# The payload is a directory of markdown and a few kilobytes of JavaScript.
# There is no build step, so this is a single stage: a builder stage would copy
# the same files twice to produce a smaller context, not a smaller image.
FROM node:22-alpine

# Lifecycle scripts are disabled. The package declares none, and running them
# by default is supply-chain risk with nothing to offset it. `--omit=dev` keeps
# the test-only tree out of the image; `.dockerignore` already excludes the
# test files themselves, so this image cannot run its own suite.
#
# Dependencies are installed from the lockfile only. `npm ci` fails rather than
# silently resolving something the lockfile does not contain, which is the point
# of building an image from a versioned tree.
WORKDIR /srv

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev

# `content/` is the product. It is copied, not generated, and it is the only
# thing in this image that a change to the repository is expected to alter.
COPY src ./src
COPY content ./content

# Not root. The process reads files and answers JSON-RPC, and nothing else.
USER node

# 3000 is `src/index.js`'s default, and `PORT` overrides it at runtime. The
# interface is `HOST`, which also defaults to 0.0.0.0 - every IPv4 interface.
#
# EXPOSE documents the port; it does not publish it. `docker run -p 3000:3000 …`
# is what makes the port reachable from outside the container, and forgetting
# it produces a container that is running, healthy, and connectable from
# nowhere. See wiki/environments/docker.md.
EXPOSE 3000

# HTTP is the default here, so a container that is run rather than spawned is
# reachable:
#
#   docker run --rm -p 3000:3000 -e MCP_AUTH_TOKEN lxagents-security:2.0.0
#
# HTTP refuses to start without MCP_AUTH_TOKEN (at least 32 characters): the container
# exits 1 with a line saying why, and does not run open. The token is passed at run time and
# is deliberately not an ENV line here, because a value baked into the image ships to
# everyone who pulls it. stdio never reads it.
#
# stdio is one environment variable away, and the image serves both from the
# same entry point, because they differ only in which transport is selected:
#
#   docker run --rm -i -e MCP_TRANSPORT=stdio lxagents-security:2.0.0
#
# For stdio, `-i` is not optional. Without it Docker does not attach stdin, the
# server sees closed input, and it exits at once - which reads as a broken image
# rather than a missing flag. There is nothing to publish in that form.
#
# Set MCP_ALLOWED_HOSTS whenever the container is reachable from anywhere but
# this machine. The Host allow-list is off unless it is set, and the server says
# so on startup. See wiki/environments/env.md.
ENV MCP_TRANSPORT=http
ENTRYPOINT ["node", "src/index.js"]
