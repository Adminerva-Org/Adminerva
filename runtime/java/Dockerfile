FROM eclipse-temurin:17-jdk-jammy
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      xvfb xauth sqlite3 libxerial-sqlite-jdbc-java \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin runner
RUN mkdir -p /opt/adminerva
COPY --chmod=0755 runner.sh /usr/local/bin/adminerva-java-run
COPY --chmod=0755 verify-runner.sh /usr/local/bin/adminerva-java-verify
COPY SwingProbe.java /opt/adminerva/SwingProbe.java
USER 10001:10001
WORKDIR /workspace
ENV HOME=/tmp
ENTRYPOINT ["/usr/local/bin/adminerva-java-run"]
