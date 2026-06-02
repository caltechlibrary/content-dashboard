# generated with CMTools 0.0.0 fb660d9
#
# Makefile for content-dashboard documentation project
#
PROJECT = content-dashboard

BRANCH = $(shell git branch | grep '* ' | cut -d  -f 2)

build: README.md about.md search.md CITATION.cff
	@echo "$(PROJECT) documentation build complete"

website: clean-website .FORCE
	make -f website.mak

publish: website .FORCE
	./publish.bash

CITATION.cff: codemeta.json
	cmt codemeta.json CITATION.cff

README.md: codemeta.json
	cmt codemeta.json README.md

about.md: codemeta.json
	cmt codemeta.json about.md

search.md: codemeta.json
	cmt codemeta.json search.md

status:
	git status

save:
	@if [ "$(msg)" != "" ]; then git commit -am "$(msg)"; else git commit -am "Quick Save"; fi
	git push origin $(BRANCH)

clean-website:
	rm -f *.html

clean: clean-website
	@echo "$(PROJECT) cleaned"

.FORCE:

.PHONY: build website status save clean-website clean
