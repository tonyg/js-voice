all:
	$(MAKE) -C libs
	mkdir -p dist/
	npm install .

clean:
	rm -f dist/*.js

emclean: clean
	$(MAKE) -C libs emclean

veryclean: emclean
	$(MAKE) -C libs veryclean
	rm -rf node_modules/
