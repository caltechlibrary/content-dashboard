#!/bin/bash

APP_NAME="$(basename "$0")"

WORK_DIR="$(dirname "$0")"
cd "${WORK_DIR}" || exit 1

function display_help() {
    cat <<HELP
% ${APP_NAME}(1) user manual
% R. S. Doiel
% 2025-05-09

# NAME

${APP_NAME}

# SYNOPIS

${APP_NAME}

# DESCRIPTION

${APP_NAME} checks to see if the required software is available to run the reports.

# OPTIONS

-h, --help
: display this help page.


# EXAMPLE

~~~shell
${APP_NAME}
~~~

HELP
}

case "$1" in
  -h|--help|help)
  display_help
  exit 0;
  ;;
esac

# Make sure we have the legacy apps in the bin directory included.
export PATH="./bin:$PATH"

#
# Check software needed and their versions
#
function check_version() {
    OPT="$1"
	VERSION="$2"
	CMD="$3"
	if command -v "${CMD}" >/dev/null; then
		HAS_VERSION=$("${CMD}" "${OPT}" | grep "${VERSION}")
		if [ "$HAS_VERSION" = "" ]; then
			echo "${CMD} version check: expected ${VERSION}, got $("${CMD}" "${OPT}")"
		fi
	else
		echo "${CMD} is missing, aborting"
		exit 1
	fi
}

#
# Check all of dataset and CMTools are installed
#

## dataset  >= 2.5 (use the latest release)
VERSION='2.5.1'
for CMD in dataset datasetd; do
	check_version "-version" "${VERSION}" "${CMD}"
done
echo "Found dataset, review any displayed version information"
echo ""

## dataset  >= 2.5 (use the latest release)
VERSION='0.0.45'
for CMD in cme cmt; do
	check_version "-version" "${VERSION}" "${CMD}"
done
echo "Found CMTools, review any displayed version information"
echo ""


#
# Now check the OS distribution supplied tools
#
echo "Checking for bash, sqlite3"
echo "Review any displayed version information"
echo ""
## - Bash >= 3.2 (or equivalent POSIX shell)
check_version "--version" "3.2" "bash"
## - SQlite3 >= 3.50
check_version "--version" "3.50" "sqlite3"
## - Deno >= 2.4
check_version "--version" "2.8" "deno"
