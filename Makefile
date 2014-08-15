all:
	make -C libs
	npm install .

clean:
	rm -f dist/*.js

veryclean: clean
	rm -rf node_modules/
