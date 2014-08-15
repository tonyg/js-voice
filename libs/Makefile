OPUS := opus-1.1
EMCC_OPTS := -O1 -s LINKABLE=1
SRCDIR := ../src

all: $(SRCDIR)/speexdsp.js $(SRCDIR)/opus.js

$(SRCDIR)/speexdsp.js: speexdsp-git $(SRCDIR)/speexdsp-pre.js $(SRCDIR)/speexdsp-post.js
	emcc $(EMCC_OPTS) \
		-s EXPORTED_FUNCTIONS="$$(cat $(SRCDIR)/speexdsp.exports)" \
		-o $@ \
		--pre-js $(SRCDIR)/speexdsp-pre.js \
		--post-js $(SRCDIR)/speexdsp-post.js \
		$(wildcard speexdsp-git/libspeexdsp/.libs/*.o)

speexdsp-git:
	unzip speexdsp-git.zip
	(cd speexdsp-git; ./autogen.sh)
	(cd speexdsp-git; emconfigure ./configure --prefix=`pwd`/dist)
	(cd speexdsp-git; emmake make)

$(SRCDIR)/opus.js: $(OPUS) $(SRCDIR)/opus-pre.js $(SRCDIR)/opus-post.js
	emcc $(EMCC_OPTS) \
		-s EXPORTED_FUNCTIONS="$$(cat $(SRCDIR)/opus.exports)" \
		-o $@ \
		--pre-js $(SRCDIR)/opus-pre.js \
		--post-js $(SRCDIR)/opus-post.js \
		$(OPUS)/.libs/libopus.a

$(OPUS): $(OPUS).tar.gz
	tar -zxvf $<
	(cd $(OPUS);\
		emconfigure ./configure --prefix=`pwd`/dist; \
		emmake make)

clean:
	rm -f $(SRCDIR)/speexdsp.js
	rm -f $(SRCDIR)/opus.js

veryclean: clean
	rm -rf speexdsp-git
	rm -rf $(OPUS)
