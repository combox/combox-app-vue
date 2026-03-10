{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  packages = with pkgs; [
    nodejs_22
    npm
    git
    python3
    pkg-config
  ];

  shellHook = ''
    echo "combox-app-vue nix shell: node $(node -v)"
  '';
}
