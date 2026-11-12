FROM eclipse-temurin:17-jdk-jammy
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin runner
COPY --chmod=0755 runner.sh /usr/local/bin/adminerva-java-run
USER 10001:10001
WORKDIR /workspace
ENV HOME=/tmp
ENTRYPOINT ["/usr/local/bin/adminerva-java-run"]
