# SELinux Setup for Minecraft Servers

## Overview

SELinux (Security-Enhanced Linux) is enabled by default on Oracle Linux, RHEL, and CentOS. While it provides important security benefits, it can prevent Java processes from running if not properly configured.

## ⚠️ DO NOT Disable SELinux Globally

**Never run** `sudo setenforce 0` in production. This disables all SELinux protections system-wide and creates security vulnerabilities.

## Recommended Approach

Dashblock automatically sets the correct SELinux context when creating servers using `restorecon`. However, if you encounter permission issues, follow these steps:

### Option 1: Allow Java to Execute from User Directories (Recommended)

```bash
# Allow the minecraft user's directories to execute Java
sudo semanage fcontext -a -t bin_t "/home/opc/minecraft(/.*)?"
sudo restorecon -Rv /home/opc/minecraft
```

### Option 2: Set Permissive Mode for Specific Domain

If you still have issues, you can set Java processes to permissive mode (logs but doesn't block):

```bash
# Check current SELinux status
sudo sestatus

# Set java to permissive (affects only Java, not entire system)
sudo semanage permissive -a java_t
```

### Option 3: Create Custom SELinux Policy (Advanced)

For production systems, create a custom policy:

```bash
# 1. Run the server and capture denials
sudo ausearch -m AVC,USER_AVC -ts recent > /tmp/minecraft-denials.txt

# 2. Generate policy from denials
sudo audit2allow -a -M minecraft_server < /tmp/minecraft-denials.txt

# 3. Install the policy
sudo semodule -i minecraft_server.pp
```

## Verify SELinux Configuration

```bash
# Check if SELinux is enforcing
getenforce

# Check SELinux context of minecraft directories
ls -lZ /home/opc/minecraft/

# View SELinux denials (if any)
sudo ausearch -m AVC,USER_AVC -ts recent

# Check if specific service is allowed
sudo sealert -a /var/log/audit/audit.log
```

## Troubleshooting

### Server Won't Start (SELinux Blocking)

1. **Check audit logs:**
   ```bash
   sudo ausearch -m AVC -ts recent
   ```

2. **Temporarily test with permissive mode:**
   ```bash
   # ONLY FOR TESTING - revert afterwards
   sudo setenforce 0
   # Try starting server
   # If it works, SELinux is the issue
   sudo setenforce 1
   ```

3. **Set correct context:**
   ```bash
   sudo restorecon -Rv /home/opc/minecraft
   ```

### systemd Service Won't Start

```bash
# Check systemd service status
sudo systemctl status mc-your-server-name.service

# Check journal logs
sudo journalctl -u mc-your-server-name.service -n 50
```

## Production Best Practices

1. ✅ **Keep SELinux enabled** (`enforcing` mode)
2. ✅ **Use proper file contexts** (automatic with Dashblock)
3. ✅ **Create custom policies** for production deployments
4. ✅ **Monitor audit logs** regularly
5. ❌ **Never disable SELinux globally**

## Sudoers Configuration

To allow the SSH user to manage systemd services without entering a password:

```bash
# Create sudoers file for minecraft management
sudo visudo -f /etc/sudoers.d/dashblock

# Add these lines (replace 'opc' with your SSH user):
opc ALL=(ALL) NOPASSWD: /usr/bin/systemctl start mc-*
opc ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop mc-*
opc ALL=(ALL) NOPASSWD: /usr/bin/systemctl status mc-*
opc ALL=(ALL) NOPASSWD: /usr/bin/systemctl enable mc-*
opc ALL=(ALL) NOPASSWD: /usr/bin/systemctl disable mc-*
opc ALL=(ALL) NOPASSWD: /usr/bin/systemctl daemon-reload
opc ALL=(ALL) NOPASSWD: /usr/bin/systemctl is-active mc-*
opc ALL=(ALL) NOPASSWD: /bin/rm -f /etc/systemd/system/mc-*.service
```

## References

- [SELinux User's and Administrator's Guide](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/using_selinux/index)
- [Oracle Linux SELinux Documentation](https://docs.oracle.com/en/operating-systems/oracle-linux/8/security/selinux.html)
- [audit2allow man page](https://linux.die.net/man/1/audit2allow)
