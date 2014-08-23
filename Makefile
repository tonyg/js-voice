all:
	make -C libs
	npm install .

clean:
	rm -f dist/*.js

emclean: clean
	make -C libs emclean

veryclean: emclean
	make -C libs veryclean
	rm -rf node_modules/
