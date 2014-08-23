OPUS := opus-1.1
EMCC_OPTS := -O3 --memory-init-file 0 -s LINKABLE=1
SRCDIR := ../src

all: $(SRCDIR)/c_code.js

$(SRCDIR)/c_code.js: \
		$(SRCDIR)/c_code-pre.js \
		$(SRCDIR)/c_code-post.js \
		$(SRCDIR)/c_code.exports
	$(MAKE) speexdsp-git $(OPUS)
	emcc $(EMCC_OPTS) \
		-s EXPORTED_FUNCTIONS="$$(cat $(SRCDIR)/c_code.exports)" \
		-o $@ \
		--pre-js $(SRCDIR)/c_code-pre.js \
		--post-js $(SRCDIR)/c_code-post.js \
		$(wildcard speexdsp-git/libspeexdsp/.libs/*.o) \
		$(OPUS)/.libs/libopus.a

speexdsp-git:
	unzip speexdsp-git.zip
	(cd speexdsp-git; ./autogen.sh)
	(cd speexdsp-git; emconfigure ./configure --prefix=`pwd`/dist)
	(cd speexdsp-git; emmake $(MAKE))

$(OPUS): $(OPUS).tar.gz
	tar -zxvf $<
	(cd $(OPUS);\
		emconfigure ./configure --prefix=`pwd`/dist; \
		emmake $(MAKE))

clean:

emclean: clean
	rm -f $(SRCDIR)/c_code.js

veryclean: emclean
	rm -rf speexdsp-git
	rm -rf $(OPUS)
